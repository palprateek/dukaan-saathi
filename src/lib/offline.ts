import type {
  Customer,
  DaySummary,
  Item,
  ReceiptLine,
  ShopState,
  TurnResult,
  Unit,
} from '../../shared/types';
import { parse, type ParsedCommand } from '../../server/nlu/parser';
import { formatQty, rupees, similarity } from '../../server/nlu/normalize';

export interface OfflineOp {
  id: string;
  text: string;
  at: string;
  source: 'voice' | 'text';
}

interface Cache {
  state: ShopState;
  summary: DaySummary;
  at: string;
}

const WRITES = ['stock_in', 'sale', 'credit', 'payment'];

function scoped(kind: string, base: string): string {
  return `dukaan.${kind}:${base || 'same-origin'}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: offline mode degrades, the shop does not stop.
  }
}

export function loadCache(base: string): Cache | null {
  return readJson<Cache | null>(scoped('cache', base), null);
}

export function saveCache(base: string, state: ShopState, summary: DaySummary): void {
  writeJson(scoped('cache', base), { state, summary, at: new Date().toISOString() });
}

export function loadQueue(base: string): OfflineOp[] {
  const rows = readJson<OfflineOp[]>(scoped('outbox', base), []);
  return Array.isArray(rows) ? rows.filter((row) => row && typeof row.text === 'string') : [];
}

export function saveQueue(base: string, ops: OfflineOp[]): void {
  writeJson(scoped('outbox', base), ops.slice(-500));
}

export function queueOp(base: string, op: OfflineOp): OfflineOp[] {
  const next = [...loadQueue(base), op];
  saveQueue(base, next);
  return next;
}

export function removeOp(base: string, id: string): OfflineOp[] {
  const next = loadQueue(base).filter((op) => op.id !== id);
  saveQueue(base, next);
  return next;
}

function localId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isToday(iso: string): boolean {
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function computeLocalSummary(state: ShopState): DaySummary {
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
    date: new Date().toISOString().slice(0, 10),
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

function resolveItem(state: ShopState, command: ParsedCommand): Item | undefined {
  if (!command.item) return undefined;
  return state.items.find((row) => row.id === command.item?.id) ?? command.item;
}

function resolveCustomer(state: ShopState, command: ParsedCommand): Customer {
  const name = command.customer?.name ?? command.customerName ?? '';
  const found =
    (command.customer && state.customers.find((row) => row.id === command.customer?.id)) ||
    state.customers.find((row) => similarity(row.name, name) >= 0.86);
  if (found) return found;
  const customer: Customer = {
    id: localId('cus'),
    name: name.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()),
    balance: 0,
    lastActivity: new Date().toISOString(),
  };
  state.customers.push(customer);
  return customer;
}

function result(
  state: ShopState,
  fields: {
    reply: string;
    intent: string;
    confidence: number;
    lines?: ReceiptLine[];
    receiptTitle?: string;
    warnings?: string[];
    choices?: TurnResult['choices'];
  },
): TurnResult {
  const summary = computeLocalSummary(state);
  return {
    reply: fields.reply,
    speak: fields.reply,
    intent: fields.intent,
    confidence: fields.confidence,
    engine: 'local',
    actions: [],
    choices: fields.choices ?? [],
    receipt: fields.lines?.length
      ? { title: fields.receiptTitle ?? 'Offline entry', lines: fields.lines }
      : undefined,
    transcript: '',
    warnings: fields.warnings ?? [],
    state,
    summary,
  };
}

function summaryReply(summary: DaySummary): string {
  const bits = [
    `Aaj ${rupees(summary.salesTotal)} ki sale hui — ${rupees(summary.cashSales)} cash aur ${rupees(summary.creditGiven)} udhaar.`,
    `Cash ${rupees(summary.cashReceived)} mila.`,
  ];
  if (summary.topItem) {
    bits.push(`Sabse zyada ${summary.topItem.name} gaya — ${formatQty(summary.topItem.qty, summary.topItem.unit)}.`);
  }
  bits.push(
    summary.customersWithDues > 0
      ? `${summary.customersWithDues} customer ka kul ${rupees(summary.udhaarOutstanding)} udhaar baaki hai.`
      : 'Kisi ka udhaar baaki nahi hai.',
  );
  return bits.join(' ');
}

/**
 * Apply a turn against the cached shop while the server is unreachable. Only
 * fully-specified writes and read-only queries are handled; anything needing a
 * confirmation is left for the server rather than guessed.
 */
export function offlineTurn(
  text: string,
  sourceState: ShopState,
  source: 'voice' | 'text',
): { result: TurnResult; queue: boolean } | null {
  const state = structuredClone(sourceState);
  const parsed = parse(text, state.items, state.customers);
  const commands = parsed.commands;
  const first = commands[0];
  if (!first) return null;

  const intent = parsed.intent;
  const summary = computeLocalSummary(state);

  if (intent === 'greet' || intent === 'help') {
    return {
      queue: false,
      result: result(state, {
        reply: 'Namaste! Abhi server se connection nahi hai — sale, udhaar aur stock phone par likh sakte hain, sync baad mein hoga.',
        intent,
        confidence: 0.8,
      }),
    };
  }

  if (intent === 'summary') {
    return {
      queue: false,
      result: result(state, {
        reply: summaryReply(summary),
        intent,
        confidence: first.confidence,
        receiptTitle: 'Aaj ka hisaab (offline)',
        lines: [
          { label: 'Kul sale', value: rupees(summary.salesTotal), tone: 'pos' },
          { label: 'Cash sale', value: rupees(summary.cashSales) },
          { label: 'Udhaar diya', value: rupees(summary.creditGiven), tone: 'neg' },
          { label: 'Cash mila', value: rupees(summary.cashReceived) },
        ],
      }),
    };
  }

  if (intent === 'stock_query') {
    if (first.item) {
      const item = first.item;
      return {
        queue: false,
        result: result(state, {
          reply: `${item.name}: ${formatQty(item.stock, item.unit)} bacha hai (${rupees(item.price)}/${item.unit}).${item.stock <= item.lowStockAt ? ' Kam hai.' : ''}`,
          intent,
          confidence: first.confidence,
          receiptTitle: `${item.name} stock`,
          lines: [
            { label: 'Bacha', value: formatQty(item.stock, item.unit), tone: item.stock <= item.lowStockAt ? 'neg' : 'pos' },
            { label: 'Rate', value: `${rupees(item.price)}/${item.unit}` },
          ],
        }),
      };
    }
    const low = summary.lowStock;
    return {
      queue: false,
      result: result(state, {
        reply: low.length
          ? `${low.length} item khatam hone wale hain: ${low.map((row) => `${row.name} ${formatQty(row.stock, row.unit)}`).join(', ')}.`
          : 'Sab stock theek hai.',
        intent,
        confidence: 0.85,
      }),
    };
  }

  if (intent === 'low_stock') {
    const low = summary.lowStock;
    return {
      queue: false,
      result: result(state, {
        reply: low.length
          ? `${low.length} item khatam hone wale hain: ${low.map((row) => `${row.name} ${formatQty(row.stock, row.unit)}`).join(', ')}.`
          : 'Sab stock theek hai — abhi koi item khatam nahi ho raha.',
        intent,
        confidence: 0.85,
        receiptTitle: 'Mangwana hai',
        lines: low.map((row) => ({
          label: row.name,
          value: formatQty(row.stock, row.unit),
          tone: 'neg' as const,
        })),
      }),
    };
  }

  if (intent === 'khata_query') {
    const customer = first.customer;
    if (customer) {
      const fresh = state.customers.find((row) => row.id === customer.id) ?? customer;
      return {
        queue: false,
        result: result(state, {
          reply:
            fresh.balance > 0
              ? `${fresh.name} ka ${rupees(fresh.balance)} udhaar baaki hai.`
              : `${fresh.name} ka khata clear hai.`,
          intent,
          confidence: first.confidence,
          receiptTitle: `${fresh.name} ka khata`,
          lines: [{ label: 'Baki', value: rupees(Math.max(0, fresh.balance)), tone: fresh.balance > 0 ? 'neg' : 'pos' }],
        }),
      };
    }
    const dues = state.customers.filter((row) => row.balance !== 0).sort((a, b) => b.balance - a.balance);
    return {
      queue: false,
      result: result(state, {
        reply: dues.length
          ? `${dues.length} customer ka kul ${rupees(summary.udhaarOutstanding)} udhaar baaki hai: ${dues.map((row) => `${row.name} ${rupees(row.balance)}`).join(', ')}.`
          : 'Kisi ka udhaar baaki nahi hai.',
        intent,
        confidence: 0.85,
        receiptTitle: 'Udhaar khata',
        lines: dues.map((row) => ({ label: row.name, value: rupees(row.balance), tone: 'neg' as const })),
      }),
    };
  }

  if (intent === 'undo') {
    return {
      queue: false,
      result: result(state, {
        reply: 'Undo ke liye server chahiye. Connection aane par turant undo kar sakte hain.',
        intent,
        confidence: 0.7,
      }),
    };
  }

  const writes = commands.filter((command) => WRITES.includes(command.intent));
  if (writes.length === 0) {
    return {
      queue: false,
      result: result(state, {
        reply: 'Abhi server se connection nahi hai. Sale, udhaar, vasooli ya stock ki entry bol kar phone par save kar sakte hain.',
        intent: intent || 'unknown',
        confidence: first.confidence,
      }),
    };
  }

  // A write with a missing slot would need a question/confirmation. Do not
  // invent numbers offline; leave the turn for the server.
  const incomplete = writes.some((command) => {
    if (command.intent === 'stock_in') return !command.item || command.qty === undefined;
    if (command.intent === 'sale') {
      return command.amount === undefined && (!command.item || command.qty === undefined);
    }
    if (command.intent === 'credit') {
      return (
        (!command.item && command.qty === undefined) ||
        (command.qty === undefined && command.amount === undefined) ||
        (!command.customer && !command.customerName)
      );
    }
    if (command.intent === 'payment') return (!command.customer && !command.customerName) || command.amount === undefined;
    return false;
  });
  if (incomplete) {
    return {
      queue: false,
      result: result(state, {
        reply: 'Offline mode mein thoda aur vivaran chahiye — kaunsa item, kitna, ya kitne rupaye. Jaise: "2 kilo chawal 120 mein bech diya".',
        intent: first.intent,
        confidence: first.confidence,
      }),
    };
  }

  const replies: string[] = [];
  const lines: ReceiptLine[] = [];
  const warnings: string[] = [];
  const now = new Date().toISOString();

  for (const command of writes) {
    const item = resolveItem(state, command);
    let qty = command.qty;
    let amount = command.amount;
    if ((command.intent === 'sale' || command.intent === 'credit') && item) {
      if (qty === undefined && amount !== undefined && item.price > 0) qty = round3(amount / item.price);
      if (amount === undefined && qty !== undefined) amount = round2(qty * item.price);
    }

    if (command.intent === 'stock_in') {
      if (!item || qty === undefined) continue;
      item.stock = round3(item.stock + qty);
      state.txns.push({
        id: localId('txn'),
        ts: now,
        type: 'stock_in',
        itemId: item.id,
        itemName: item.name,
        qty,
        unit: item.unit,
        amount: round2(qty * item.cost),
        source,
      });
      replies.push(`${item.name} ${formatQty(qty, item.unit)} stock mein add — ab ${formatQty(item.stock, item.unit)}.`);
      lines.push({ label: `${item.name} aaya`, value: `+${formatQty(qty, item.unit)}`, tone: 'pos' });
    }

    if (command.intent === 'sale') {
      if (item && qty !== undefined) {
        item.stock = round3(item.stock - qty);
        const revenue = amount ?? round2(qty * item.price);
        state.txns.push({
          id: localId('txn'),
          ts: now,
          type: 'sale',
          itemId: item.id,
          itemName: item.name,
          qty,
          unit: item.unit,
          amount: revenue,
          source,
        });
        replies.push(`${formatQty(qty, item.unit)} ${item.name} bech diya — ${rupees(revenue)}.`);
        lines.push({ label: `${item.name} × ${qty}`, value: rupees(revenue), tone: 'pos' });
        if (item.stock < 0) warnings.push(`${item.name} ka stock minus mein chala gaya.`);
      } else {
        const revenue = amount ?? 0;
        state.txns.push({ id: localId('txn'), ts: now, type: 'sale', amount: revenue, source });
        replies.push(`${rupees(revenue)} ki sale likh di.`);
        lines.push({ label: 'Sale', value: rupees(revenue), tone: 'pos' });
      }
    }

    if (command.intent === 'credit') {
      const customer = resolveCustomer(state, command);
      const value = amount ?? (item && qty !== undefined ? round2(qty * item.price) : 0);
      customer.balance = round2(customer.balance + value);
      customer.lastActivity = now;
      if (item && qty !== undefined) item.stock = round3(item.stock - qty);
      state.txns.push({
        id: localId('txn'),
        ts: now,
        type: 'credit',
        itemId: item?.id,
        itemName: item?.name,
        qty,
        unit: item?.unit,
        amount: value,
        customerId: customer.id,
        customerName: customer.name,
        source,
      });
      replies.push(`${rupees(value)} ${customer.name} ke khate mein — ab ${rupees(customer.balance)} baaki.`);
      lines.push({ label: customer.name, value: rupees(customer.balance), tone: 'neg' });
    }

    if (command.intent === 'payment') {
      const customer = resolveCustomer(state, command);
      const value = amount ?? 0;
      customer.balance = round2(customer.balance - value);
      customer.lastActivity = now;
      state.txns.push({
        id: localId('txn'),
        ts: now,
        type: 'payment',
        amount: value,
        customerId: customer.id,
        customerName: customer.name,
        source,
      });
      replies.push(`${customer.name} se ${rupees(value)} mila.`);
      lines.push({ label: 'Jama', value: rupees(value), tone: 'pos' });
    }
  }

  if (!lines.length) return null;
  state.updatedAt = now;

  return {
    queue: true,
    result: result(state, {
      reply: `${replies.join(' ')} Offline save ho gaya — server milte hi sync hoga.`,
      intent: writes[0].intent,
      confidence: Math.min(...writes.map((command) => command.confidence)),
      receiptTitle: 'Phone par saved',
      lines,
      warnings,
      choices: [
        { id: 'off-1', label: 'Aaj ka hisaab', value: 'Aaj kitni sale hui?' },
        { id: 'off-2', label: 'Khata', value: 'Sabka udhaar kitna hai?' },
      ],
    }),
  };
}
