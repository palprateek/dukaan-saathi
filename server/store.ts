import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Customer, DaySummary, Item, ShopState, Txn, Unit } from '../shared/types';
import { CUSTOMER_SEEDS, ITEM_SEEDS } from './nlu/lexicon';

const DATA_FILE =
  process.env.DUKAAN_DATA_FILE ?? path.resolve(process.cwd(), 'data/shop.json');

let cache: ShopState | null = null;

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function atToday(hours: number, minutes: number): string {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function createSeedItems(): Item[] {
  return ITEM_SEEDS.map((seed) => ({
    id: `itm_${slug(seed.name)}`,
    name: seed.name,
    nameHi: seed.nameHi,
    unit: seed.unit,
    aliases: seed.aliases,
    price: seed.price,
    cost: seed.cost,
    stock: seed.stock,
    lowStockAt: seed.lowStockAt,
  }));
}

function createSeedCustomers(): Customer[] {
  return CUSTOMER_SEEDS.map((seed) => ({
    id: `cus_${slug(seed.name)}`,
    name: seed.name,
    nameHi: seed.nameHi,
    balance: seed.balance,
    lastActivity: atToday(9, 15),
  }));
}

function seedTransactions(items: Item[], customers: Customer[]): Txn[] {
  const byName = (name: string) => items.find((item) => item.name === name);
  const chawal = byName('Chawal');
  const doodh = byName('Doodh');
  const biscuit = byName('Biscuit');
  const atta = byName('Atta');
  const imran = customers.find((customer) => customer.name === 'Imran');
  const ramesh = customers.find((customer) => customer.name === 'Ramesh');

  const rows: Txn[] = [
    {
      id: 'txn_seed_1',
      ts: atToday(9, 12),
      type: 'sale',
      itemId: doodh?.id,
      itemName: 'Doodh',
      qty: 2,
      unit: 'litre',
      amount: 120,
      note: 'Counter sale',
      source: 'seed',
    },
    {
      id: 'txn_seed_2',
      ts: atToday(10, 5),
      type: 'sale',
      itemId: biscuit?.id,
      itemName: 'Biscuit',
      qty: 3,
      unit: 'packet',
      amount: 60,
      note: 'Counter sale',
      source: 'seed',
    },
    {
      id: 'txn_seed_3',
      ts: atToday(11, 20),
      type: 'credit',
      itemId: atta?.id,
      itemName: 'Atta',
      qty: 2,
      unit: 'kg',
      amount: 90,
      customerId: imran?.id,
      customerName: 'Imran',
      note: 'Khate mein likha',
      source: 'seed',
    },
    {
      id: 'txn_seed_4',
      ts: atToday(12, 40),
      type: 'payment',
      amount: 500,
      customerId: ramesh?.id,
      customerName: 'Ramesh',
      note: 'Purana udhaar',
      source: 'seed',
    },
    {
      id: 'txn_seed_5',
      ts: atToday(13, 5),
      type: 'stock_in',
      itemId: chawal?.id,
      itemName: 'Chawal',
      qty: 20,
      unit: 'kg',
      amount: 960,
      note: 'Mandir wale bhaiya se',
      source: 'seed',
    },
  ];
  return rows;
}

export function createSeedState(): ShopState {
  const items = createSeedItems();
  const customers = createSeedCustomers();
  return {
    shop: { name: 'Sharma Kirana Store', owner: 'Rakesh Sharma', city: 'Jaipur' },
    items,
    customers,
    txns: seedTransactions(items, customers),
    updatedAt: new Date().toISOString(),
  };
}

function ensureDataDir(): void {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}

export function dataFile(): string {
  return DATA_FILE;
}

export function loadState(): ShopState {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const state = JSON.parse(raw) as ShopState;
    // Older ledgers predate `nameHi`; enrich the seed customers in memory so
    // Hindi transcripts can still match their khata entries.
    const hindiNames = new Map(CUSTOMER_SEEDS.map((seed) => [seed.name, seed.nameHi]));
    state.customers = state.customers.map((customer) => ({
      ...customer,
      nameHi: customer.nameHi ?? hindiNames.get(customer.name),
    }));
    cache = state;
    return cache;
  } catch {
    const seeded = createSeedState();
    cache = seeded;
    saveState(seeded);
    return seeded;
  }
}

export function saveState(state: ShopState): void {
  ensureDataDir();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
  cache = state;
}

/** Apply a change atomically and persist it. */
export function mutate<T>(fn: (state: ShopState) => T): { result: T; state: ShopState } {
  const state = structuredClone(loadState());
  const result = fn(state);
  state.updatedAt = new Date().toISOString();
  saveState(state);
  return { result, state };
}

export function resetState(): ShopState {
  const fresh = createSeedState();
  saveState(fresh);
  return fresh;
}

export function isToday(iso: string): boolean {
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

export function computeSummary(state: ShopState): DaySummary {
  const todays = state.txns.filter((txn) => isToday(txn.ts));
  let salesTotal = 0;
  let cashSales = 0;
  let creditGiven = 0;
  let payments = 0;
  let purchasesValue = 0;
  let billCount = 0;
  const sold = new Map<string, { name: string; qty: number; unit: Unit }>();

  for (const txn of todays) {
    if (txn.type === 'sale') {
      salesTotal += txn.amount ?? 0;
      cashSales += txn.amount ?? 0;
      billCount += 1;
    } else if (txn.type === 'credit') {
      salesTotal += txn.amount ?? 0;
      creditGiven += txn.amount ?? 0;
      billCount += 1;
    } else if (txn.type === 'payment') {
      payments += txn.amount ?? 0;
    } else if (txn.type === 'stock_in') {
      purchasesValue += txn.amount ?? 0;
    }

    if ((txn.type === 'sale' || txn.type === 'credit') && txn.itemName && txn.qty !== undefined) {
      const key = txn.itemId ?? txn.itemName;
      const current = sold.get(key);
      sold.set(key, {
        name: txn.itemName,
        qty: (current?.qty ?? 0) + txn.qty,
        unit: txn.unit ?? current?.unit ?? 'piece',
      });
    }
  }

  const top = [...sold.values()].sort((a, b) => b.qty - a.qty)[0];
  const lowStock = state.items
    .filter((item) => item.stock <= item.lowStockAt)
    .sort((a, b) => a.stock - b.stock)
    .map((item) => ({
      id: item.id,
      name: item.name,
      stock: item.stock,
      unit: item.unit,
      lowStockAt: item.lowStockAt,
    }));

  const withDues = state.customers.filter((customer) => customer.balance > 0);

  return {
    date: todayKey(),
    salesTotal: round2(salesTotal),
    cashSales: round2(cashSales),
    creditGiven: round2(creditGiven),
    cashReceived: round2(cashSales + payments),
    billCount,
    purchasesValue: round2(purchasesValue),
    topItem: top ? { name: top.name, qty: round2(top.qty), unit: top.unit } : undefined,
    lowStock,
    udhaarOutstanding: round2(withDues.reduce((sum, customer) => sum + customer.balance, 0)),
    customersWithDues: withDues.length,
    txnCount: todays.length,
  };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
