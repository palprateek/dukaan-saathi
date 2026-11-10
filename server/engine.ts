import type {
  ActionOutcome,
  Choice,
  Customer,
  DaySummary,
  Item,
  Receipt,
  ReceiptLine,
  ShopState,
  Txn,
  TurnResult,
} from '../shared/types';
import { detectIntent, parse, type MissingSlot, type ParsedCommand, type ParsedUtterance } from './nlu/parser';
import { formatQty, normalize, rupees, similarity } from './nlu/normalize';
import { computeSummary, loadState, mutate, newId, round2 } from './store';
import { integrations, understandWithEvon } from './gnani';

export const EXAMPLES = [
  'Aaj 20 kilo chawal aaya aur 5 kilo sugar',
  'Ramesh ko 2 kilo chawal udhaar diya',
  '2 kilo cheeni 120 rupaye mein bech di',
  'Ramesh ne 500 rupaye diye',
  'Aaj kitni sale hui?',
  'Chawal kitna bacha hai?',
  'Kya khatam ho raha hai?',
  'Ramesh ka kitna udhaar hai?',
  'Chawal ka rate 65 karo',
  'Galti ho gayi, undo karo',
];

interface PendingAction {
  command: ParsedCommand;
  question: string;
  choices: Choice[];
  at: number;
  expect: 'confirm' | 'fill';
  force: boolean;
}

const pendingBySession = new Map<string, PendingAction>();
const PENDING_TTL_MS = 5 * 60 * 1000;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function makeResult(
  state: ShopState,
  transcript: string,
  fields: {
    reply: string;
    speak: string;
    intent: string;
    confidence: number;
    engine?: 'local' | 'evon';
    actions?: ActionOutcome[];
    choices?: Choice[];
    receipt?: Receipt;
    pendingQuestion?: string;
    warnings?: string[];
  },
): TurnResult {
  return {
    reply: fields.reply,
    speak: fields.speak,
    intent: fields.intent,
    confidence: fields.confidence,
    engine: fields.engine ?? 'local',
    actions: fields.actions ?? [],
    choices: fields.choices ?? [],
    receipt: fields.receipt,
    pendingQuestion: fields.pendingQuestion,
    transcript,
    warnings: fields.warnings ?? [],
    state,
    summary: computeSummary(state),
  };
}

function missingFor(command: ParsedCommand): MissingSlot[] {
  const missing: MissingSlot[] = [];
  switch (command.intent) {
    case 'stock_in':
      if (!command.item) missing.push('item');
      if (command.qty === undefined) missing.push('qty');
      break;
    case 'sale':
      if (!command.item && command.amount === undefined) missing.push('item');
      if (command.qty === undefined && command.amount === undefined) missing.push('qty');
      break;
    case 'credit':
      if (!command.item && command.amount === undefined) missing.push('item');
      if (command.qty === undefined && command.amount === undefined) missing.push('qty');
      if (!command.customer && !command.customerName) missing.push('customer');
      break;
    case 'payment':
      if (!command.customer && !command.customerName) missing.push('customer');
      if (command.amount === undefined) missing.push('amount');
      break;
    case 'set_price':
      if (!command.item) missing.push('item');
      if (command.amount === undefined) missing.push('amount');
      break;
    case 'add_item':
      if (!command.newItemName) missing.push('new_item');
      if (command.amount === undefined) missing.push('amount');
      break;
    default:
      break;
  }
  return missing;
}

function itemChoices(state: ShopState): Choice[] {
  return state.items.slice(0, 5).map((item) => ({
    id: item.id,
    label: `${item.name} · ${item.price}/${item.unit}`,
    value: `${item.name} ${item.unit}`,
  }));
}

function customerChoices(customers: Customer[], prefix = ''): Choice[] {
  return customers
    .filter((customer) => customer.balance > 0)
    .slice(0, 4)
    .map((customer) => ({
      id: customer.id,
      label: `${customer.name} · ${rupees(customer.balance)}`,
      value: `${prefix}${customer.name}`,
    }));
}

function ask(
  sessionId: string,
  command: ParsedCommand,
  question: string,
  choices: Choice[],
  state: ShopState,
  transcript: string,
  options: { expect?: 'confirm' | 'fill'; force?: boolean; extra?: Partial<Pick<TurnResult, 'receipt' | 'warnings'>> } = {},
): TurnResult {
  const expect = options.expect ?? 'fill';
  const force = options.force ?? false;
  pendingBySession.set(sessionId, {
    command,
    question,
    choices,
    at: Date.now(),
    expect,
    force,
  });
  return makeResult(state, transcript, {
    reply: question,
    speak: question,
    intent: command.intent,
    confidence: command.confidence,
    choices,
    pendingQuestion: question,
    receipt: options.extra?.receipt,
    warnings: options.extra?.warnings,
  });
}

function questionFor(slot: MissingSlot, command: ParsedCommand, state: ShopState): { question: string; choices: Choice[] } {
  const item = command.item;
  switch (slot) {
    case 'item':
      return {
        question: 'Kaunsa saman? Naam boliye ya neeche se chuniye.',
        choices: itemChoices(state),
      };
    case 'qty': {
      const unit = item?.unit ?? 'kg';
      const label = item?.name ?? 'Saman';
      const spokenUnit =
        unit === 'kg' ? 'kilo' : unit === 'litre' ? 'litre' : unit === 'piece' ? 'piece' : unit;
      return {
        question: `${label} kitna ${spokenUnit}?`,
        choices: [1, 2, 5].map((n) => ({
          id: `qty-${n}`,
          label: `${n} ${unit}`,
          value: `${n} ${unit}`,
        })),
      };
    }
    case 'customer':
      return {
        question: 'Kiska khata? Naam boliye.',
        choices: customerChoices(state.customers),
      };
    case 'amount':
      return {
        question: 'Kitne rupaye?',
        choices: [50, 100, 500].map((n) => ({
          id: `amt-${n}`,
          label: rupees(n),
          value: `${n} rupaye`,
        })),
      };
    case 'new_item':
      return { question: 'Naye item ka naam kya hai?', choices: [] };
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

interface Prepared {
  command: ParsedCommand;
  qty?: number;
  amount?: number;
}

function prepare(command: ParsedCommand): Prepared {
  let qty = command.qty;
  let amount = command.amount;
  const item = command.item;
  if (command.intent === 'sale' || command.intent === 'credit') {
    if (qty === undefined && amount !== undefined && item && item.price > 0) {
      qty = round3(amount / item.price);
    }
    if (amount === undefined && qty !== undefined && item) {
      amount = round2(qty * item.price);
    }
  }
  return { command, qty, amount };
}

function stockShort(prepared: Prepared): boolean {
  const { command, qty } = prepared;
  return Boolean(
    command.item &&
      qty !== undefined &&
      (command.intent === 'sale' || command.intent === 'credit') &&
      qty > command.item.stock + 1e-9,
  );
}

interface WriteOutcome {
  line: string;
  speak: string;
  lines: ReceiptLine[];
  warnings: string[];
  txn: Txn;
}

function pushTxn(state: ShopState, txn: Omit<Txn, 'id' | 'ts'>): Txn {
  const full: Txn = { ...txn, id: newId('txn'), ts: new Date().toISOString() };
  state.txns.push(full);
  return full;
}

function findOrCreateCustomer(state: ShopState, name: string): Customer {
  const existing = state.customers.find(
    (customer) => similarity(customer.name, name) >= 0.86,
  );
  if (existing) return existing;
  const customer: Customer = {
    id: newId('cus'),
    name,
    balance: 0,
    lastActivity: new Date().toISOString(),
  };
  state.customers.push(customer);
  return customer;
}

function applyWrite(
  state: ShopState,
  prepared: Prepared,
  source: 'voice' | 'text',
): WriteOutcome {
  const { command, qty, amount } = prepared;
  // Resolve against the draft, not the command's snapshot of the shop.
  const item = command.item
    ? state.items.find((row) => row.id === command.item?.id) ?? command.item
    : undefined;
  const warnings: string[] = [];

  switch (command.intent) {
    case 'stock_in': {
      if (!item || qty === undefined) throw new Error('incomplete stock_in');
      item.stock = round3(item.stock + qty);
      const value = round2(qty * item.cost);
      const txn = pushTxn(state, {
        type: 'stock_in',
        itemId: item.id,
        itemName: item.name,
        qty,
        unit: item.unit,
        amount: value,
        source,
      });
      const low = item.stock <= item.lowStockAt ? ` Stock abhi bhi kam hai.` : '';
      return {
        line: `${item.name} ${formatQty(qty, item.unit)} stock mein add — ab ${formatQty(item.stock, item.unit)}.${low}`,
        speak: `${item.name} ${formatQty(qty, item.unit)} stock mein add kar diya. Ab ${formatQty(item.stock, item.unit)} bacha hai.`,
        lines: [
          { label: `${item.name} aaya`, value: `+${formatQty(qty, item.unit)}`, tone: 'pos' },
          { label: 'Ab stock', value: formatQty(item.stock, item.unit) },
          { label: 'Lagat', value: rupees(value), tone: 'muted' },
        ],
        warnings,
        txn,
      };
    }
    case 'sale': {
      if (item && qty !== undefined) {
        item.stock = round3(item.stock - qty);
        const revenue = amount ?? round2(qty * item.price);
        const txn = pushTxn(state, {
          type: 'sale',
          itemId: item.id,
          itemName: item.name,
          qty,
          unit: item.unit,
          amount: revenue,
          source,
        });
        if (item.stock < 0) warnings.push(`${item.name} ka stock minus mein chala gaya.`);
        else if (item.stock <= item.lowStockAt) warnings.push(`${item.name} kam ho gaya — mangwana padega.`);
        return {
          line: `${formatQty(qty, item.unit)} ${item.name} bech diya — ${rupees(revenue)}. Ab ${formatQty(item.stock, item.unit)} bacha hai.`,
          speak: `${formatQty(qty, item.unit)} ${item.name} ki sale, ${rupees(revenue)}. Ab ${formatQty(item.stock, item.unit)} bacha hai.`,
          lines: [
            { label: `${item.name} × ${qty}`, value: rupees(revenue), tone: 'pos' },
            { label: 'Ab stock', value: formatQty(item.stock, item.unit) },
          ],
          warnings,
          txn,
        };
      }
      // Bill-only sale: money recorded, stock unchanged.
      const revenue = amount ?? 0;
      const txn = pushTxn(state, { type: 'sale', amount: revenue, source });
      return {
        line: `${rupees(revenue)} ki sale likh di.`,
        speak: `${rupees(revenue)} ki sale likh di.`,
        lines: [{ label: 'Sale', value: rupees(revenue), tone: 'pos' }],
        warnings,
        txn,
      };
    }
    case 'credit': {
      const name = command.customer?.name ?? command.customerName ?? '';
      const customer = findOrCreateCustomer(state, name);
      const value = amount ?? (item && qty !== undefined ? round2(qty * item.price) : 0);
      customer.balance = round2(customer.balance + value);
      customer.lastActivity = new Date().toISOString();
      command.customer = customer;
      if (item && qty !== undefined) item.stock = round3(item.stock - qty);
      const txn = pushTxn(state, {
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
      if (item && qty !== undefined && item.stock <= item.lowStockAt) {
        warnings.push(`${item.name} kam ho gaya — mangwana padega.`);
      }
      const itemPart = item && qty !== undefined ? `${formatQty(qty, item.unit)} ${item.name}, ` : '';
      const speakPart =
        item && qty !== undefined
          ? `${formatQty(qty, item.unit)} ${item.name}, ${rupees(value)}`
          : `${rupees(value)} udhaar`;
      return {
        line: `${itemPart}${rupees(value)} ${customer.name} ke khate mein chadha diya. Ab ${customer.name} ka udhaar ${rupees(customer.balance)}.`,
        speak: `${speakPart}, ${customer.name} ke khate mein. Ab ${rupees(customer.balance)} baaki hai.`,
        lines: [
          { label: customer.name, value: rupees(customer.balance), tone: 'neg' },
          { label: 'Aaj diya', value: rupees(value) },
          ...(item && qty !== undefined ? [{ label: item.name, value: formatQty(qty, item.unit) }] : []),
        ],
        warnings,
        txn,
      };
    }
    case 'payment': {
      const name = command.customer?.name ?? command.customerName ?? '';
      const customer = findOrCreateCustomer(state, name);
      const value = amount ?? 0;
      customer.balance = round2(customer.balance - value);
      customer.lastActivity = new Date().toISOString();
      command.customer = customer;
      const txn = pushTxn(state, {
        type: 'payment',
        amount: value,
        customerId: customer.id,
        customerName: customer.name,
        source,
      });
      const remaining =
        customer.balance > 0
          ? `${rupees(customer.balance)} abhi baaki hai.`
          : customer.balance < 0
            ? `${rupees(Math.abs(customer.balance))} advance jama ho gaya.`
            : 'Khata clear ho gaya.';
      return {
        line: `${customer.name} se ${rupees(value)} mila. ${remaining}`,
        speak: `${customer.name} se ${rupees(value)} jama. ${remaining}`,
        lines: [
          { label: 'Jama', value: rupees(value), tone: 'pos' },
          { label: 'Baki udhaar', value: rupees(Math.max(0, customer.balance)) },
        ],
        warnings,
        txn,
      };
    }
    case 'set_price': {
      if (!item || command.amount === undefined) throw new Error('incomplete set_price');
      const previous = item.price;
      item.price = round2(command.amount);
      const txn = pushTxn(state, {
        type: 'price',
        itemId: item.id,
        itemName: item.name,
        amount: item.price,
        note: `${previous} → ${item.price}`,
        source,
      });
      return {
        line: `${item.name} ka rate ${rupees(previous)} se ${rupees(item.price)} kar diya.`,
        speak: `${item.name} ka rate ${rupees(item.price)} kar diya.`,
        lines: [
          { label: 'Naya rate', value: `${rupees(item.price)}/${item.unit}`, tone: 'pos' },
          { label: 'Purana rate', value: rupees(previous), tone: 'muted' },
        ],
        warnings,
        txn,
      };
    }
    case 'add_item': {
      const name = command.newItemName ?? 'Naya item';
      const unit = command.newItemUnit ?? 'piece';
      const item2: Item = {
        id: newId('itm'),
        name,
        nameHi: name,
        unit,
        aliases: [name.toLowerCase(), normalize(name)],
        price: round2(command.amount ?? 0),
        cost: round2((command.amount ?? 0) * 0.8),
        stock: 0,
        lowStockAt: 5,
      };
      state.items.push(item2);
      const txn = pushTxn(state, {
        type: 'adjust',
        itemId: item2.id,
        itemName: item2.name,
        amount: item2.price,
        note: 'Naya item',
        source,
      });
      return {
        line: `${name} add ho gaya — ${rupees(item2.price)}/${unit}. Stock 0 hai, maal aane par bataiye.`,
        speak: `${name} add ho gaya, ${rupees(item2.price)} ${unit}.`,
        lines: [
          { label: name, value: `${rupees(item2.price)}/${unit}`, tone: 'pos' },
          { label: 'Stock', value: `0 ${unit}`, tone: 'muted' },
        ],
        warnings,
        txn,
      };
    }
    default:
      throw new Error(`not a write intent: ${command.intent}`);
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function summaryLine(summary: DaySummary): string {
  const bits: string[] = [];
  bits.push(
    `Aaj ${rupees(summary.salesTotal)} ki sale hui — ${rupees(summary.cashSales)} cash aur ${rupees(summary.creditGiven)} udhaar.`,
  );
  bits.push(`Cash ${rupees(summary.cashReceived)} mila.`);
  if (summary.topItem) {
    bits.push(`Sabse zyada ${summary.topItem.name} gaya — ${formatQty(summary.topItem.qty, summary.topItem.unit)}.`);
  }
  if (summary.customersWithDues > 0) {
    bits.push(`${summary.customersWithDues} customer ka kul ${rupees(summary.udhaarOutstanding)} udhaar baaki hai.`);
  } else {
    bits.push('Kisi ka udhaar baaki nahi hai.');
  }
  if (summary.lowStock.length) {
    bits.push(`${summary.lowStock.length} item khatam hone wale hain.`);
  }
  return bits.join(' ');
}

function answerQuery(
  state: ShopState,
  command: ParsedCommand | undefined,
  transcript: string,
  engine: 'local' | 'evon',
): TurnResult {
  const summary = computeSummary(state);
  const intent = command?.intent ?? 'summary';

  if (intent === 'summary') {
    const lines: ReceiptLine[] = [
      { label: 'Kul sale', value: rupees(summary.salesTotal), tone: 'pos' },
      { label: 'Cash sale', value: rupees(summary.cashSales) },
      { label: 'Udhaar diya', value: rupees(summary.creditGiven), tone: 'neg' },
      { label: 'Cash mila', value: rupees(summary.cashReceived) },
      { label: 'Bills', value: String(summary.billCount) },
      { label: 'Udhaar baaki', value: rupees(summary.udhaarOutstanding), tone: 'muted' },
    ];
    return makeResult(state, transcript, {
      reply: summaryLine(summary),
      speak: summaryLine(summary),
      intent,
      confidence: command?.confidence ?? 0.9,
      engine,
      receipt: { title: 'Aaj ka hisaab', lines },
      choices: [
        { id: 'c1', label: 'Kya khatam ho raha hai?', value: 'Kya khatam ho raha hai?' },
        { id: 'c2', label: 'Ramesh ka khata', value: 'Ramesh ka kitna udhaar hai?' },
      ],
    });
  }

  if (intent === 'stock_query') {
    if (command?.item) {
      const item = command.item;
      const low = item.stock <= item.lowStockAt;
      const value = round2(item.stock * item.price);
      return makeResult(state, transcript, {
        reply: `${item.name}: ${formatQty(item.stock, item.unit)} bacha hai (${rupees(item.price)}/${item.unit}).${low ? ' Kam hai — mangwana padega.' : ' Theek hai.'}`,
        speak: `${item.name} ${formatQty(item.stock, item.unit)} bacha hai. ${low ? 'Kam hai.' : ''}`,
        intent,
        confidence: command.confidence,
        engine,
        receipt: {
          title: `${item.name} stock`,
          lines: [
            { label: 'Bacha', value: formatQty(item.stock, item.unit), tone: low ? 'neg' : 'pos' },
            { label: 'Rate', value: `${rupees(item.price)}/${item.unit}` },
            { label: 'Stock value', value: rupees(value), tone: 'muted' },
            { label: 'Low stock alert', value: `${item.lowStockAt} ${item.unit}`, tone: 'muted' },
          ],
        },
        choices: [
          { id: 'c1', label: 'Aaj ki sale', value: 'Aaj kitni sale hui?' },
          { id: 'c2', label: 'Kya khatam ho raha hai?', value: 'Kya khatam ho raha hai?' },
        ],
      });
    }
    const low = summary.lowStock;
    const shown = state.items
      .slice()
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 8);
    return makeResult(state, transcript, {
      reply: `Dukaan mein ${state.items.length} item hain.${low.length ? ` ${low.length} khatam hone wale hain: ${low.map((row) => `${row.name} ${formatQty(row.stock, row.unit)}`).join(', ')}.` : ' Sab stock theek hai.'}`,
      speak: `${state.items.length} item hain. ${low.length} khatam hone wale hain.`,
      intent,
      confidence: command?.confidence ?? 0.85,
      engine,
      receipt: {
        title: 'Stock nazar',
        lines: shown.map((item) => ({
          label: item.name,
          value: formatQty(item.stock, item.unit),
          tone: item.stock <= item.lowStockAt ? ('neg' as const) : undefined,
        })),
      },
      choices: state.items.slice(0, 4).map((item) => ({
        id: item.id,
        label: `${item.name} kitna bacha?`,
        value: `${item.name} kitna bacha hai?`,
      })),
    });
  }

  if (intent === 'low_stock') {
    const low = summary.lowStock;
    if (!low.length) {
      return makeResult(state, transcript, {
        reply: 'Sab stock theek hai — abhi koi item khatam nahi ho raha.',
        speak: 'Sab stock theek hai.',
        intent,
        confidence: command?.confidence ?? 0.85,
        engine,
      });
    }
    return makeResult(state, transcript, {
      reply: `${low.length} item khatam hone wale hain: ${low
        .map((row) => `${row.name} ${formatQty(row.stock, row.unit)}`)
        .join(', ')}.`,
      speak: `${low.length} item khatam hone wale hain. ${low
        .map((row) => `${row.name} ${formatQty(row.stock, row.unit)}`)
        .join(', ')}.`,
      intent,
      confidence: command?.confidence ?? 0.85,
      engine,
      receipt: {
        title: 'Mangwana hai',
        lines: low.map((row) => ({
          label: row.name,
          value: `${formatQty(row.stock, row.unit)} (alert ${row.lowStockAt} ${row.unit})`,
          tone: 'neg' as const,
        })),
      },
      choices: low.slice(0, 3).map((row) => ({
        id: row.id,
        label: `${row.name} kitna bacha?`,
        value: `${row.name} kitna bacha hai?`,
      })),
    });
  }

  if (intent === 'khata_query') {
    const customer = command?.customer;
    if (customer) {
      const fresh = state.customers.find((row) => row.id === customer.id) ?? customer;
      const last = state.txns
        .filter((txn) => txn.customerId === fresh.id)
        .slice(-1)[0];
      const lastText = last
        ? ` Aakhri entry: ${new Date(last.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} — ${last.type === 'payment' ? 'jama' : 'udhaar'} ${rupees(last.amount ?? 0)}.`
        : '';
      return makeResult(state, transcript, {
        reply:
          fresh.balance > 0
            ? `${fresh.name} ka ${rupees(fresh.balance)} udhaar baaki hai.${lastText}`
            : fresh.balance < 0
              ? `${fresh.name} ke paas ${rupees(Math.abs(fresh.balance))} advance jama hai.${lastText}`
              : `${fresh.name} ka khata clear hai.${lastText}`,
        speak:
          fresh.balance > 0
            ? `${fresh.name} ka ${rupees(fresh.balance)} udhaar baaki hai.`
            : `${fresh.name} ka khata clear hai.`,
        intent,
        confidence: command?.confidence ?? 0.9,
        engine,
        receipt: {
          title: `${fresh.name} ka khata`,
          lines: [
            { label: 'Baki', value: rupees(Math.max(0, fresh.balance)), tone: fresh.balance > 0 ? 'neg' : 'pos' },
            ...(last
              ? [
                  {
                    label: last.type === 'payment' ? 'Aakhri jama' : 'Aakhri udhaar',
                    value: rupees(last.amount ?? 0),
                  },
                ]
              : []),
          ],
        },
        choices: [
          { id: 'c1', label: 'Vasooli likho', value: `${fresh.name} ne 100 rupaye diye` },
          { id: 'c2', label: 'Sab khata', value: 'Sabka udhaar kitna hai?' },
        ],
      });
    }
    const withDues = state.customers
      .filter((row) => row.balance !== 0)
      .sort((a, b) => b.balance - a.balance);
    if (!withDues.length) {
      return makeResult(state, transcript, {
        reply: 'Kisi ka udhaar baaki nahi hai. Sab khata clear hai.',
        speak: 'Sab khata clear hai.',
        intent,
        confidence: command?.confidence ?? 0.85,
        engine,
      });
    }
    return makeResult(state, transcript, {
      reply: `${withDues.length} customer ka kul ${rupees(summary.udhaarOutstanding)} udhaar baaki hai: ${withDues
        .map((row) => `${row.name} ${rupees(row.balance)}`)
        .join(', ')}.`,
      speak: `${withDues.length} customer ka kul ${rupees(summary.udhaarOutstanding)} udhaar baaki hai.`,
      intent,
      confidence: command?.confidence ?? 0.85,
      engine,
      receipt: {
        title: 'Udhaar khata',
        lines: withDues.map((row) => ({ label: row.name, value: rupees(row.balance), tone: 'neg' as const })),
      },
      choices: state.customers
        .filter((row) => row.balance > 0)
        .slice(0, 4)
        .map((row) => ({
          id: `khata-${row.id}`,
          label: `${row.name} · ${rupees(row.balance)}`,
          value: `${row.name} ka kitna udhaar hai?`,
        })),
    });
  }

  return makeResult(state, transcript, {
    reply: 'Ye sawaal abhi samajh nahi aaya. Aaj ka hisaab poochhiye — "aaj kitni sale hui?"',
    speak: 'Aaj ka hisaab poochhiye.',
    intent: 'unknown',
    confidence: 0.3,
    engine,
  });
}

function helpResult(state: ShopState, transcript: string, engine: 'local' | 'evon'): TurnResult {
  return makeResult(state, transcript, {
    reply:
      'Main bol kar dukaan sambhalta hoon. Stock aaya boliye, sale boliye, udhaar likhwaaye, ya hisaab poochhiye. Jaise: "20 kilo chawal aaya", "Ramesh ko 2 kilo chawal udhaar", "2 kilo sugar bech di", "aaj kitni sale hui".',
    speak:
      'Boliye — stock aaya, sale hui, udhaar likhna hai, ya hisaab chahiye.',
    intent: 'help',
    confidence: 0.9,
    engine,
    choices: EXAMPLES.slice(0, 4).map((example, index) => ({
      id: `ex-${index}`,
      label: example,
      value: example,
    })),
  });
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

interface UndoInfo {
  label: string;
  itemName?: string;
  amount?: number;
}

function undoLast(state: ShopState, transcript: string, engine: 'local' | 'evon'): TurnResult {
  const candidate = [...state.txns].reverse().find((txn) => txn.source !== 'seed');
  if (!candidate) {
    return makeResult(state, transcript, {
      reply: 'Abhi koi nayi entry nahi hai jo wapas karoon.',
      speak: 'Koi nayi entry nahi hai.',
      intent: 'undo',
      confidence: 0.8,
      engine,
    });
  }

  const { result: info, state: next } = mutate((draft) => {
    let index = -1;
    for (let i = draft.txns.length - 1; i >= 0; i--) {
      if (draft.txns[i].source !== 'seed') {
        index = i;
        break;
      }
    }
    const txn = draft.txns[index];
    const item = txn.itemId ? draft.items.find((row) => row.id === txn.itemId) : undefined;
    const customer = txn.customerId
      ? draft.customers.find((row) => row.id === txn.customerId)
      : undefined;

    if (item && txn.qty !== undefined) {
      if (txn.type === 'stock_in') item.stock = round3(item.stock - txn.qty);
      if (txn.type === 'sale' || txn.type === 'credit') item.stock = round3(item.stock + txn.qty);
    }
    if (customer) {
      if (txn.type === 'credit' && txn.amount !== undefined) {
        customer.balance = round2(customer.balance - txn.amount);
      }
      if (txn.type === 'payment' && txn.amount !== undefined) {
        customer.balance = round2(customer.balance + txn.amount);
      }
    }
    draft.txns.splice(index, 1);

    const label =
      txn.type === 'sale'
        ? 'sale'
        : txn.type === 'credit'
          ? 'udhaar'
          : txn.type === 'payment'
            ? 'vasooli'
            : txn.type === 'stock_in'
              ? 'stock entry'
              : 'entry';
    return { label, itemName: txn.itemName, amount: txn.amount } satisfies UndoInfo;
  });

  return makeResult(next, transcript, {
    reply: `Aakhri ${info.label} wapas kar diya${info.itemName ? ` — ${info.itemName}` : ''}${info.amount !== undefined ? `, ${rupees(info.amount)}` : ''}.`,
    speak: `Aakhri ${info.label} wapas kar diya.`,
    intent: 'undo',
    confidence: 0.9,
    engine,
    receipt: {
      title: 'Undo',
      lines: [
        {
          label: 'Hataayi entry',
          value: `${info.label}${info.itemName ? ` · ${info.itemName}` : ''}`,
        },
        ...(info.amount !== undefined
          ? [{ label: 'Raashi', value: rupees(info.amount), tone: 'muted' as const }]
          : []),
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// Turn orchestration
// ---------------------------------------------------------------------------

async function understand(
  text: string,
  state: ShopState,
): Promise<{ parsed: ParsedUtterance; engine: 'local' | 'evon' }> {
  if (integrations.evon) {
    const remote = await understandWithEvon(text, state.items, state.customers);
    if (remote) return { parsed: remote, engine: 'evon' };
  }
  return { parsed: parse(text, state.items, state.customers), engine: 'local' };
}

function executePrepared(
  prepared: Prepared[],
  sessionId: string,
  source: 'voice' | 'text',
  transcript: string,
  engine: 'local' | 'evon',
): TurnResult {
  const { result, state } = mutate((draft) => {
    const outcomes = prepared.map((entry) => applyWrite(draft, entry, source));
    return outcomes;
  });
  pendingBySession.delete(sessionId);

  const lines = result.flatMap((outcome) => outcome.lines);
  const warnings = result.flatMap((outcome) => outcome.warnings);
  const actions: ActionOutcome[] = result.map((outcome) => ({
    type: outcome.txn.type,
    status: 'done',
    message: outcome.line,
    txnId: outcome.txn.id,
  }));
  const titles = new Set(result.map((outcome) => outcome.txn.type));
  const title =
    titles.size === 1
      ? {
          sale: 'Sale darj',
          credit: 'Udhaar darj',
          payment: 'Vasooli darj',
          stock_in: 'Stock update',
          price: 'Rate update',
          adjust: 'Item update',
        }[[...titles][0] as string] ?? 'Dukaan update'
      : 'Ek saath update';

  return makeResult(state, transcript, {
    reply: result.map((outcome) => outcome.line).join(' '),
    speak: result.map((outcome) => outcome.speak).join(' '),
    intent: prepared[0]?.command.intent ?? 'unknown',
    confidence: Math.min(...prepared.map((entry) => entry.command.confidence)),
    engine,
    actions,
    receipt: { title, lines },
    warnings,
  });
}

function respond(
  parsed: ParsedUtterance,
  sessionId: string,
  source: 'voice' | 'text',
  transcript: string,
  engine: 'local' | 'evon',
): TurnResult {
  const state = loadState();
  const commands = parsed.commands;
  const first = commands[0];
  const intent = parsed.intent;

  if (intent === 'help') return helpResult(state, transcript, engine);
  if (intent === 'greet') {
    return makeResult(state, transcript, {
      reply: `Namaste ${state.shop.owner.split(' ')[0]} ji! Bataiye — maal aaya, sale hui, ya khata dekhna hai?`,
      speak: 'Namaste! Bataiye, kya likhna hai?',
      intent,
      confidence: 0.9,
      engine,
      choices: EXAMPLES.slice(0, 3).map((example, index) => ({
        id: `greet-${index}`,
        label: example,
        value: example,
      })),
    });
    }
  if (intent === 'affirm' || intent === 'deny') {
    return makeResult(state, transcript, {
      reply: intent === 'affirm' ? 'Haan ji, bataiye.' : 'Theek hai.',
      speak: intent === 'affirm' ? 'Haan ji.' : 'Theek hai.',
      intent,
      confidence: 0.7,
      engine,
    });
  }
  if (intent === 'undo') return undoLast(state, transcript, engine);
  if (['summary', 'stock_query', 'low_stock', 'khata_query'].includes(intent)) {
    return answerQuery(state, first, transcript, engine);
  }

  const writeIntents = ['stock_in', 'sale', 'credit', 'payment', 'set_price', 'add_item'];
  if (!writeIntents.includes(intent)) {
    const remoteReply = parsed.commands.find((command) => command.intent !== 'unknown');
    if (remoteReply) return answerQuery(state, remoteReply, transcript, engine);
    return makeResult(state, transcript, {
      reply:
        'Samajh nahi aaya. Thoda saaf boliye — jaise "20 kilo chawal aaya", "Ramesh ko 2 kilo chawal udhaar", ya "aaj kitni sale hui".',
      speak: 'Samajh nahi aaya. Dobara boliye.',
      intent: 'unknown',
      confidence: first?.confidence ?? 0.2,
      engine,
      choices: EXAMPLES.slice(0, 4).map((example, index) => ({
        id: `ex-${index}`,
        label: example,
        value: example,
      })),
    });
  }

  // Slot filling first: never invent a quantity or a customer.
  for (const command of commands) {
    const missing = missingFor(command);
    if (missing.length) {
      if (command.missing.length === 0) command.missing = missing;
      const slot = missing[0];
      const { question, choices } = questionFor(slot, command, state);
      command.missing = missing;
      return ask(sessionId, command, question, choices, state, transcript);
    }
  }

  const prepared = commands.map(prepare);

  // Stock guard: a sale that would empty the shelf asks once.
  const short = prepared.find(stockShort);
  if (short) {
    const qty = short.qty ?? 0;
    const item = short.command.item as Item;
    return ask(
      sessionId,
      short.command,
      `${item.name} ka stock sirf ${formatQty(item.stock, item.unit)} hai, ${formatQty(qty, item.unit)} ki entry stock minus kar degi. Phir bhi likh du?`,
      [
        { id: 'yes', label: 'Haan, likh do', value: 'haan' },
        { id: 'no', label: 'Nahi, rehne do', value: 'nahi' },
      ],
      state,
      transcript,
      { expect: 'confirm', force: true },
    );
  }

  // Heard-it-wrong guard: repaired item names get one confirmation.
  const fuzzy = commands.find(
    (command) => command.itemMatches[0]?.fuzzy && command.confidence < 0.8,
  );
  if (fuzzy?.item) {
    const matched = fuzzy.itemMatches[0];
    return ask(
      sessionId,
      fuzzy,
      `"${matched.alias}" — maine ${fuzzy.item.name} samjha. Sahi hai?`,
      [
        { id: 'yes', label: `Haan, ${fuzzy.item.name}`, value: 'haan' },
        { id: 'no', label: 'Nahi', value: 'nahi' },
      ],
      state,
      transcript,
      { expect: 'confirm' },
    );
  }

  return executePrepared(prepared, sessionId, source, transcript, engine);
}

function mergeAnswer(
  pending: PendingAction,
  text: string,
  state: ShopState,
): boolean {
  const command = pending.command;
  const parsed = parse(text, state.items, state.customers);
  const answer = parsed.commands[0];
  const missing = missingFor(command);
  let merged = false;

  if (missing.includes('item') && answer?.item) {
    command.item = answer.item;
    command.itemMatches = answer.itemMatches;
    merged = true;
  }
  if (missing.includes('qty') && answer?.qty !== undefined) {
    command.qty = answer.qty;
    command.unit = answer.unit ?? command.item?.unit;
    merged = true;
  }
  if (missing.includes('amount') && answer?.amount !== undefined) {
    command.amount = answer.amount;
    merged = true;
  }
  if (missing.includes('customer')) {
    const numeric = /^\s*(\p{L}[\p{L}\s]{1,30})$/u.exec(text);
    const direct = numeric ? numeric[1].trim() : '';
    let customer = answer?.customer;
    if (!customer && direct) {
      customer = state.customers.find((row) => similarity(row.name, direct) >= 0.8);
      if (!customer && direct.split(' ').length <= 2) {
        command.customerName = direct.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
        merged = true;
      }
    }
    if (customer) {
      command.customer = customer;
      command.customerName = customer.name;
      merged = true;
    }
  }
  if (missing.includes('new_item') && answer?.newItemName) {
    command.newItemName = answer.newItemName;
    merged = true;
  }
  if (missing.includes('amount') && command.amount === undefined) {
    const digits = normalize(text).match(/\d+(?:\.\d+)?/);
    if (digits) {
      command.amount = Number(digits[0]);
      merged = true;
    }
  }
  command.missing = missingFor(command);
  return merged;
}

function resolvePending(
  pending: PendingAction,
  text: string,
  sessionId: string,
  source: 'voice' | 'text',
  engine: 'local' | 'evon',
): TurnResult | null {
  const state = loadState();
  const intent = detectIntent(text).intent;

  if (intent === 'deny') {
    pendingBySession.delete(sessionId);
    return makeResult(state, text, {
      reply: 'Theek hai, cancel kar diya. Koi entry nahi likhi.',
      speak: 'Theek hai, cancel.',
      intent: 'deny',
      confidence: 0.9,
      engine,
    });
  }

  if (pending.expect === 'confirm' && intent === 'affirm') {
    return executePrepared([prepare(pending.command)], sessionId, source, text, engine);
  }

  const merged = mergeAnswer(pending, text, state);
  if (!merged) return null;

  const missing = missingFor(pending.command);
  if (missing.length) {
    const { question, choices } = questionFor(missing[0], pending.command, state);
    return ask(sessionId, pending.command, question, choices, state, text, {
      force: pending.force,
    });
  }

  // Without an explicit "haan" a repaired slot still gets one check when the
  // original command needed a confirmation.
  if (pending.expect === 'confirm' && !pending.force && intent !== 'affirm') {
    return ask(
      sessionId,
      pending.command,
      `${pending.command.item?.name ?? 'Entry'} — theek hai?`,
      [
        { id: 'yes', label: 'Haan', value: 'haan' },
        { id: 'no', label: 'Nahi', value: 'nahi' },
      ],
      state,
      text,
      { expect: 'confirm', force: pending.force },
    );
  }

  return executePrepared([prepare(pending.command)], sessionId, source, text, engine);
}

export interface TurnInput {
  text: string;
  sessionId: string;
  source?: 'voice' | 'text';
}

export async function handleTurn(input: TurnInput): Promise<TurnResult> {
  const source = input.source ?? 'text';
  const text = input.text.trim();
  const sessionId = input.sessionId || 'default';
  const state = loadState();

  if (!text) {
    return helpResult(state, text, 'local');
  }

  const existing = pendingBySession.get(sessionId);
  if (existing && Date.now() - existing.at > PENDING_TTL_MS) {
    pendingBySession.delete(sessionId);
  }

  const pending = pendingBySession.get(sessionId);
  if (pending) {
    const answered = resolvePending(pending, text, sessionId, source, 'local');
    if (answered) return answered;
    pendingBySession.delete(sessionId);
  }

  const { parsed, engine } = await understand(text, state);
  return respond(parsed, sessionId, source, text, engine);
}

export function getBootstrap() {
  const state = loadState();
  return {
    state,
    summary: computeSummary(state),
    examples: EXAMPLES,
    integrations: {
      prisma: integrations.prisma,
      evon: integrations.evon,
      timbre: integrations.timbre,
    },
  };
}

export function clearSession(sessionId: string): void {
  pendingBySession.delete(sessionId);
}
