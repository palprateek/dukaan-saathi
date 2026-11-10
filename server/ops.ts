import fs from 'node:fs';
import path from 'node:path';

/**
 * Offline entries are replayed with a client-generated op id. Keep a small
 * durable set so a retry after a dropped response cannot double-post a sale.
 */
const OPS_FILE =
  process.env.DUKAAN_OPS_FILE ?? path.resolve(process.cwd(), 'data/applied-ops.json');
const MAX_OPS = 2000;

let cache: string[] | null = null;

function load(): string[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(OPS_FILE, 'utf8')) as unknown;
    cache = Array.isArray(parsed) ? parsed.filter((row): row is string => typeof row === 'string') : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save(): void {
  try {
    fs.mkdirSync(path.dirname(OPS_FILE), { recursive: true });
    const tmp = `${OPS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(load()), 'utf8');
    fs.renameSync(tmp, OPS_FILE);
  } catch {
    // A replay guard must never stop the shop from recording a sale.
  }
}

export function wasApplied(opId: string): boolean {
  return load().includes(opId);
}

export function markApplied(opId: string): void {
  const list = load();
  if (list.includes(opId)) return;
  list.push(opId);
  if (list.length > MAX_OPS) list.splice(0, list.length - MAX_OPS);
  save();
}
