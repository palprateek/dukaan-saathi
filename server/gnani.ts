import type { Customer, Item, Unit } from '../shared/types';
import type { ParsedCommand, ParsedUtterance } from './nlu/parser';
import type { Intent } from './nlu/lexicon';
import { similarity } from './nlu/normalize';

/**
 * Gnani adapters.
 *
 *   Prisma → speech to text  (public REST: POST /stt/v3, multipart)
 *   Timbre → text to speech  (public REST: POST /api/v1/tts/inference, binary)
 *   Evon   → understanding   (Gnani's language model; endpoint configured per
 *                             deployment — Agent Builder / platform, not a
 *                             public transactional REST API today)
 *
 * The shop runs entirely on the local engine in `nlu/` when nothing is
 * configured. Each adapter is optional and falls back on any error, timeout or
 * missing field, so a voice integration can never break the khata.
 *
 * Env:
 *   GNANI_API_KEY        sent as X-API-Key-ID
 *   GNANI_PRISMA_URL     default https://api.vachana.ai/stt/v3
 *   GNANI_PRISMA_MODEL   default prisma-v3.0 (Hinglish + auto language)
 *   GNANI_TIMBRE_URL     default https://api.vachana.ai/api/v1/tts/inference
 *   GNANI_TIMBRE_MODEL   default timbre-v2.5
 *   GNANI_TIMBRE_VOICE   default Poorvi (Hinglish voice)
 *   GNANI_EVON_URL       required to enable Evon; JSON contract described below
 *   GNANI_LANGUAGE       default hi-IN,en-IN
 */

const API_KEY = process.env.GNANI_API_KEY ?? '';
const BASE_URL = process.env.GNANI_BASE_URL ?? 'https://api.vachana.ai';
const PRISMA_URL = process.env.GNANI_PRISMA_URL ?? `${BASE_URL}/stt/v3`;
const PRISMA_MODEL = process.env.GNANI_PRISMA_MODEL ?? 'prisma-v3.0';
const EVON_URL = process.env.GNANI_EVON_URL ?? '';
const TIMBRE_URL = process.env.GNANI_TIMBRE_URL ?? `${BASE_URL}/api/v1/tts/inference`;
const TIMBRE_MODEL = process.env.GNANI_TIMBRE_MODEL ?? 'timbre-v2.5';
const TIMBRE_VOICE = process.env.GNANI_TIMBRE_VOICE ?? 'Poorvi';
const LANGUAGE = process.env.GNANI_LANGUAGE ?? 'hi-IN,en-IN';
const TIMEOUT_MS = 12000;

export const integrations = {
  prisma: Boolean(API_KEY),
  evon: Boolean(API_KEY && EVON_URL),
  timbre: Boolean(API_KEY),
};

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...extra, 'X-API-Key-ID': API_KEY };
}

function logFailure(service: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[gnani:${service}] ${message} — falling back to the local engine`);
}

function isPrismaV3(): boolean {
  return PRISMA_MODEL.includes('v3');
}

// ---------------------------------------------------------------------------
// Prisma — speech to text
// ---------------------------------------------------------------------------

export interface TranscribeHints {
  /** Item, alias and customer words, so Prisma hears the shop's vocabulary. */
  keyterms?: string[];
  topic?: string;
}

export async function transcribeWithPrisma(
  audio: Buffer,
  mimeType: string,
  hints: TranscribeHints = {},
): Promise<string | null> {
  if (!integrations.prisma) return null;
  try {
    const form = new FormData();
    const extension = mimeType.includes('mp3')
      ? 'mp3'
      : mimeType.includes('ogg')
        ? 'ogg'
        : mimeType.includes('flac')
          ? 'flac'
          : mimeType.includes('mp4') || mimeType.includes('m4a')
            ? 'm4a'
            : 'wav';
    form.append('audio_file', new Blob([new Uint8Array(audio)], { type: mimeType }), `clip.${extension}`);
    form.append('language_code', LANGUAGE);
    form.append('model', PRISMA_MODEL);
    form.append('format', 'transcribe');

    const words = [...new Set((hints.keyterms ?? []).filter(Boolean))].slice(0, 200);
    if (isPrismaV3()) {
      if (words.length) form.append('keyterms', JSON.stringify(words));
      form.append('topic', hints.topic ?? 'kirana dukaan ki sale, stock, udhaar khata, Hinglish');
    } else {
      // Prisma v2.5 boosts single Latin words only.
      const singleWords = words.filter((word) => /^[a-zA-Z]+$/.test(word)).slice(0, 100);
      if (singleWords.length) {
        form.append('bias_list', JSON.stringify(singleWords));
        form.append('bias_score', '1.5');
      }
    }

    const response = await fetch(PRISMA_URL, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${detail.slice(0, 200)}`);
    }
    const body = (await response.json()) as {
      success?: boolean;
      transcript?: string;
      text?: string;
      truncated?: boolean;
      error?: { type?: string; message?: string };
    };
    if (body.success === false) {
      throw new Error(body.error?.type ?? 'transcription failed');
    }
    if (body.truncated) console.warn('[gnani:prisma] transcript was truncated');
    return (body.transcript ?? body.text ?? '').trim() || null;
  } catch (error) {
    logFailure('prisma', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Evon — understanding
// ---------------------------------------------------------------------------

/**
 * Evon is Gnani's language model. There is no public "transaction extraction"
 * endpoint, so this seam takes a JSON endpoint that returns the contract below.
 * Point GNANI_EVON_URL at the Evon deployment (via Gnani's Agent Builder or a
 * small proxy you host) and map its reply to these fields. Everything else in
 * Dukaan Saathi is independent of this call.
 *
 * Request:  { transcript, language, domain, context, schema }
 * Response: { transactions: [{ intent, item, quantity, unit, amount,
 *             customer, confidence }] }
 */
interface EvonTransaction {
  intent?: string;
  type?: string;
  item?: string;
  itemName?: string;
  quantity?: number | string;
  qty?: number | string;
  unit?: string;
  amount?: number | string;
  customer?: string;
  customerName?: string;
  newItemName?: string;
  confidence?: number;
}

interface EvonResponse {
  transactions?: EvonTransaction[];
  intents?: EvonTransaction[];
}

const INTENT_ALIASES: Record<string, Intent> = {
  stock_in: 'stock_in',
  stock: 'stock_in',
  purchase: 'stock_in',
  maal_aaya: 'stock_in',
  sale: 'sale',
  sold: 'sale',
  bill: 'sale',
  credit: 'credit',
  udhaar: 'credit',
  udhar: 'credit',
  khata: 'credit',
  payment: 'payment',
  vasooli: 'payment',
  paid: 'payment',
  summary: 'summary',
  report: 'summary',
  stock_query: 'stock_query',
  stock_check: 'stock_query',
  low_stock: 'low_stock',
  khata_query: 'khata_query',
  set_price: 'set_price',
  add_item: 'add_item',
  undo: 'undo',
};

const UNITS: Record<string, Unit> = {
  kg: 'kg', kilo: 'kg', gram: 'kg', g: 'kg',
  litre: 'litre', liter: 'litre', ltr: 'litre',
  packet: 'packet', pkt: 'packet', pack: 'packet',
  piece: 'piece', pcs: 'piece', pc: 'piece', nag: 'piece',
  dozen: 'dozen', darjan: 'dozen',
};

function toNumber(value: number | string | undefined): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mapTransaction(
  txn: EvonTransaction,
  items: Item[],
  customers: Customer[],
): ParsedCommand | null {
  const intent = INTENT_ALIASES[(txn.intent ?? txn.type ?? '').toLowerCase()];
  if (!intent) return null;

  const wantedItem = txn.item ?? txn.itemName;
  let item: Item | undefined;
  if (wantedItem) {
    item = items.find((row) => row.name.toLowerCase() === wantedItem.toLowerCase());
    if (!item) {
      let best = 0;
      for (const row of items) {
        for (const alias of row.aliases) {
          const score = similarity(wantedItem, alias);
          if (score > best) {
            best = score;
            item = row;
          }
        }
      }
      if (best < 0.78) item = undefined;
    }
  }

  const wantedCustomer = txn.customer ?? txn.customerName;
  const customer = wantedCustomer
    ? customers.find((row) => similarity(row.name, wantedCustomer) >= 0.8)
    : undefined;

  return {
    intent,
    confidence: Math.min(0.97, Math.max(0.3, txn.confidence ?? 0.85)),
    text: '',
    item,
    itemMatches: item
      ? [{ item, alias: wantedItem ?? item.name, score: 10, index: 0, fuzzy: false }]
      : [],
    qty: toNumber(txn.quantity ?? txn.qty),
    unit: txn.unit ? UNITS[txn.unit.toLowerCase()] : item?.unit,
    amount: toNumber(txn.amount),
    customer,
    customerName: customer?.name ?? wantedCustomer,
    newItemName: txn.newItemName,
    missing: [],
    warnings: [],
  };
}

export async function understandWithEvon(
  transcript: string,
  items: Item[],
  customers: Customer[],
): Promise<ParsedUtterance | null> {
  if (!integrations.evon) return null;
  try {
    const response = await fetch(EVON_URL, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        transcript,
        language: 'hi-IN',
        domain: 'kirana_shop',
        context: {
          items: items.map((item) => ({
            name: item.name,
            aliases: item.aliases,
            unit: item.unit,
            price: item.price,
            stock: item.stock,
          })),
          customers: customers.map((row) => ({ name: row.name, balance: row.balance })),
        },
        schema: {
          transactions:
            'intent (stock_in|sale|credit|payment|summary|stock_query|low_stock|khata_query|set_price|add_item|undo), item, quantity, unit, amount, customer, confidence',
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as EvonResponse;
    const raw = body.transactions ?? body.intents;
    if (!Array.isArray(raw) || !raw.length) return null;
    const commands = raw
      .map((txn) => mapTransaction(txn, items, customers))
      .filter((command): command is ParsedCommand => command !== null);
    if (!commands.length) return null;
    return {
      intent: commands[0].intent,
      confidence: Math.min(...commands.map((command) => command.confidence)),
      commands,
      text: transcript,
    };
  } catch (error) {
    logFailure('evon', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Timbre — text to speech
// ---------------------------------------------------------------------------

export interface SpokenAudio {
  audioBase64: string;
  mimeType: string;
}

export async function speakWithTimbre(text: string): Promise<SpokenAudio | null> {
  if (!integrations.timbre) return null;
  try {
    const response = await fetch(TIMBRE_URL, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        text,
        voice: TIMBRE_VOICE,
        model: TIMBRE_MODEL,
        language: 'hi-IN',
        speed: 1,
        // Without this the API returns headerless 16-bit PCM with an
        // application/octet-stream type, which browsers cannot play.
        audio_config: {
          sample_rate: 24000,
          num_channels: 1,
          sample_width: 2,
          encoding: 'linear_pcm',
          container: 'wav',
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${detail.slice(0, 200)}`);
    }

    const contentType = response.headers.get('content-type') ?? 'audio/wav';
    if (contentType.includes('application/json')) {
      const body = (await response.json()) as {
        audioBase64?: string;
        audio?: string;
        mimeType?: string;
        format?: string;
      };
      const audioBase64 = body.audioBase64 ?? body.audio;
      if (!audioBase64) throw new Error('no audio in JSON response');
      return {
        audioBase64,
        mimeType: body.mimeType ?? (body.format ? `audio/${body.format}` : 'audio/wav'),
      };
    }

    // Timbre REST returns the complete audio as binary.
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('empty audio response');
    return {
      audioBase64: buffer.toString('base64'),
      mimeType: contentType.split(';')[0].trim() || 'audio/wav',
    };
  } catch (error) {
    logFailure('timbre', error);
    return null;
  }
}
