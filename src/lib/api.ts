import { Capacitor } from '@capacitor/core';
import type { Bootstrap, DaySummary, ShopState, TurnResult } from '../../shared/types';

interface BootstrapResponse extends Bootstrap {
  sessionId: string;
}

const BASE_KEY = 'dukaan.apiBase';

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Native builds run from a local bundle origin, so `/api` must point at the
 * shop's server. Web builds keep relative URLs. A saved server address wins over
 * the build-time VITE_API_BASE.
 */
export function normalizeApiBase(raw: string): string {
  let value = raw.trim().replace(/\/+$/, '');
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  return value;
}

export function getApiBase(): string {
  if (typeof window === 'undefined') return '';
  const stored = window.localStorage.getItem(BASE_KEY);
  if (stored) return stored;
  return normalizeApiBase(import.meta.env.VITE_API_BASE ?? '');
}

export function saveApiBase(raw: string): string {
  const normalized = normalizeApiBase(raw);
  if (normalized) window.localStorage.setItem(BASE_KEY, normalized);
  else window.localStorage.removeItem(BASE_KEY);
  return normalized;
}

export function apiUrl(path: string): string {
  return `${getApiBase()}${path}`;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export function probeServer(raw: string): Promise<{ ok: boolean }> {
  const base = normalizeApiBase(raw);
  if (!base) return Promise.reject(new Error('Server address khali hai'));
  return fetch(`${base}/api/health`, { signal: AbortSignal.timeout(8000) }).then((response) =>
    json<{ ok: boolean }>(response),
  );
}

export function fetchBootstrap(): Promise<BootstrapResponse> {
  return fetch(apiUrl('/api/bootstrap')).then((response) => json<BootstrapResponse>(response));
}

export function sendTurn(
  text: string,
  sessionId: string,
  source: 'voice' | 'text',
  options: { opId?: string; occurredAt?: string } = {},
): Promise<TurnResult> {
  return fetch(apiUrl('/api/turn'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sessionId, source, ...options }),
  }).then((response) => json<TurnResult>(response));
}

export function fetchState(): Promise<{ state: ShopState; summary: DaySummary }> {
  return fetch(apiUrl('/api/state'), { signal: AbortSignal.timeout(8000) }).then((response) =>
    json<{ state: ShopState; summary: DaySummary }>(response),
  );
}

export interface PairInfo {
  server: string;
  deepLink: string;
  svg: string;
}

export function fetchPairing(): Promise<PairInfo> {
  return fetch(apiUrl('/api/pair')).then((response) => json<PairInfo>(response));
}

export function resetShop(): Promise<{ state: ShopState; summary: DaySummary }> {
  return fetch(apiUrl('/api/reset'), { method: 'POST' }).then((response) =>
    json<{ state: ShopState; summary: DaySummary }>(response),
  );
}

export function fetchSpeech(text: string): Promise<{ audioBase64: string; mimeType: string }> {
  return fetch(apiUrl('/api/tts'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then((response) => json<{ audioBase64: string; mimeType: string }>(response));
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const response = await fetch(apiUrl('/api/voice/transcribe'), {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/wav' },
    body: blob,
  });
  const result = await json<{ transcript: string }>(response);
  return result.transcript;
}
