import './env';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { getBootstrap, handleTurn, clearSession } from './engine';
import { computeSummary, loadState, mutate, resetState } from './store';
import { markApplied, wasApplied } from './ops';
import { integrations, speakWithTimbre, transcribeWithPrisma } from './gnani';

const app = express();
const PORT = Number(process.env.PORT ?? 8787);

// The Android shell runs from a local bundle origin, so allow cross-origin API
// calls from the phone on the shop's Wi-Fi. The API carries no credentials.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, integrations });
});

app.get('/api/bootstrap', (_req, res) => {
  res.json({ sessionId: `s_${Math.random().toString(36).slice(2, 10)}`, ...getBootstrap() });
});

app.get('/api/state', (_req, res) => {
  const state = loadState();
  res.json({ state, summary: computeSummary(state) });
});

app.post('/api/turn', async (req, res) => {
  const { text, sessionId, source, opId, occurredAt } = (req.body ?? {}) as {
    text?: string;
    sessionId?: string;
    source?: 'voice' | 'text';
    opId?: string;
    occurredAt?: string;
  };
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const safeOpId =
    typeof opId === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(opId) ? opId : undefined;
  if (safeOpId && wasApplied(safeOpId)) {
    const state = loadState();
    res.json({
      reply: 'Ye entry pehle sync ho chuki hai.',
      speak: 'Ye entry pehle sync ho chuki hai.',
      intent: 'sync',
      confidence: 1,
      engine: 'local',
      actions: [],
      choices: [],
      transcript: text,
      warnings: [],
      state,
      summary: computeSummary(state),
    });
    return;
  }

  const result = await handleTurn({
    text,
    sessionId: sessionId || 'default',
    source: source === 'voice' ? 'voice' : 'text',
  });

  // Preserve the time an offline entry was actually made, so a sale recorded
  // yesterday does not inflate today's totals when it syncs.
  if (occurredAt) {
    const at = new Date(occurredAt);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (!Number.isNaN(at.getTime()) && at.getTime() <= Date.now() && at.getTime() >= weekAgo) {
      const ids = new Set(result.actions.map((action) => action.txnId).filter(Boolean));
      if (ids.size > 0) {
        const updated = mutate((draft) => {
          draft.txns.forEach((txn) => {
            if (ids.has(txn.id)) txn.ts = at.toISOString();
          });
          return draft;
        });
        result.state = updated.state;
        result.summary = computeSummary(updated.state);
      }
    }
  }

  if (safeOpId) markApplied(safeOpId);
  res.json(result);
});

app.get('/api/pair', async (_req, res) => {
  const lan = lanAddresses()[0];
  const server =
    process.env.DUKAAN_PUBLIC_URL?.replace(/\/+$/, '') ??
    (lan ? `http://${lan}:${PORT}` : `http://127.0.0.1:${PORT}`);
  const deepLink = `dukaansaathi://pair?server=${encodeURIComponent(server)}`;
  const svg = await QRCode.toString(deepLink, {
    type: 'svg',
    margin: 1,
    width: 320,
    color: { dark: '#14532d', light: '#fffdf7' },
  });
  res.json({ server, deepLink, svg });
});

// Prisma ASR: raw audio in, transcript out. The browser records only when this
// endpoint is configured; otherwise it uses on-device speech recognition.
app.post(
  '/api/voice/transcribe',
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '12mb' }),
  async (req, res) => {
    if (!integrations.prisma) {
      res.status(501).json({
        error: 'Prisma is not configured',
        hint: 'Set GNANI_PRISMA_URL, or use browser speech recognition / typed Hinglish.',
      });
      return;
    }
    const audio = req.body as Buffer;
    if (!audio?.length) {
      res.status(400).json({ error: 'audio body is required' });
      return;
    }
    const state = loadState();
    const keyterms = [
      ...state.items.flatMap((item) => [item.name, ...item.aliases]),
      ...state.customers.map((customer) => customer.name),
    ];
    const transcript = await transcribeWithPrisma(
      audio,
      req.headers['content-type'] ?? 'audio/wav',
      { keyterms },
    );
    if (!transcript) {
      res.status(502).json({ error: 'Prisma could not transcribe the audio' });
      return;
    }
    res.json({ transcript });
  },
);

app.post('/api/tts', async (req, res) => {
  const text = (req.body as { text?: string })?.text;
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  if (!integrations.timbre) {
    res.status(501).json({
      error: 'Timbre is not configured',
      hint: 'Set GNANI_TIMBRE_URL. The browser uses SpeechSynthesis until then.',
    });
    return;
  }
  const audio = await speakWithTimbre(text);
  if (!audio) {
    res.status(502).json({ error: 'Timbre could not synthesise the reply' });
    return;
  }
  res.json(audio);
});

app.post('/api/reset', (_req, res) => {
  const state = resetState();
  res.json({ state, summary: computeSummary(state) });
});

app.post('/api/session/close', (req, res) => {
  const sessionId = (req.body as { sessionId?: string })?.sessionId;
  if (sessionId) clearSession(sessionId);
  res.json({ ok: true });
});

const dist = path.resolve(process.cwd(), 'dist');
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(dist, 'index.html'), (error) => {
    if (error) res.status(404).send('Dukaan Saathi: run `npm run build` first, or use `npm run dev`.');
  });
});

function lanAddresses(): string[] {
  const virtual = /^(docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|wg|tailscale|zt)/i;
  const entries = Object.entries(os.networkInterfaces()).flatMap(([name, nets]) =>
    (nets ?? [])
      .filter((net) => net.family === 'IPv4' && !net.internal)
      .map((net) => ({ name, address: net.address })),
  );
  const physical = entries.filter((entry) => !virtual.test(entry.name));
  const pool = physical.length > 0 ? physical : entries;
  const score = (entry: { name: string; address: string }) => {
    let value = 0;
    if (entry.address.startsWith('192.168.')) value += 30;
    else if (entry.address.startsWith('10.')) value += 25;
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)) value += 10;
    if (/^(wl|en|eth)/i.test(entry.name)) value += 20;
    return value;
  };
  const ordered = [...pool].sort((a, b) => score(b) - score(a));
  return [...new Set(ordered.map((entry) => entry.address))];
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dukaan Saathi API → http://127.0.0.1:${PORT}`);
  lanAddresses()
    .slice(0, 2)
    .forEach((address) => console.log(`Phone / Android app → http://${address}:${PORT}`));
  console.log(
    `Gnani: prisma=${integrations.prisma ? 'on' : 'off'} evon=${integrations.evon ? 'on' : 'off'} timbre=${integrations.timbre ? 'on' : 'off'} (local engine always available)`,
  );
});
