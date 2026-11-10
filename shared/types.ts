/** Everything the browser and the server agree on. */

export type Unit = 'kg' | 'litre' | 'packet' | 'piece' | 'dozen';

export interface Item {
  id: string;
  name: string;
  nameHi: string;
  unit: Unit;
  aliases: string[];
  /** Selling price per unit, in rupees. */
  price: number;
  /** Purchase cost per unit, in rupees. */
  cost: number;
  /** Current stock, in `unit`. */
  stock: number;
  /** Warn at or below this level. */
  lowStockAt: number;
}

export interface Customer {
  id: string;
  name: string;
  /** Devanagari spelling, so Hindi speech transcripts still find the khata. */
  nameHi?: string;
  /** Positive = customer owes the shop. */
  balance: number;
  lastActivity?: string;
}

export type TxnType = 'stock_in' | 'sale' | 'credit' | 'payment' | 'adjust' | 'price';

export interface Txn {
  id: string;
  ts: string;
  type: TxnType;
  itemId?: string;
  itemName?: string;
  qty?: number;
  unit?: Unit;
  /** Rupee value of the movement. */
  amount?: number;
  customerId?: string;
  customerName?: string;
  note?: string;
  source: 'voice' | 'text' | 'seed';
}

export interface ShopInfo {
  name: string;
  owner: string;
  city: string;
}

export interface ShopState {
  shop: ShopInfo;
  items: Item[];
  customers: Customer[];
  txns: Txn[];
  updatedAt: string;
}

export interface LowStockRow {
  id: string;
  name: string;
  stock: number;
  unit: Unit;
  lowStockAt: number;
}

export interface DaySummary {
  date: string;
  /** Goods sold today, cash + udhaar. */
  salesTotal: number;
  cashSales: number;
  creditGiven: number;
  cashReceived: number;
  /** Number of sale/credit entries today. */
  billCount: number;
  purchasesValue: number;
  topItem?: { name: string; qty: number; unit: Unit };
  lowStock: LowStockRow[];
  udhaarOutstanding: number;
  customersWithDues: number;
  txnCount: number;
}

export interface ReceiptLine {
  label: string;
  value: string;
  tone?: 'pos' | 'neg' | 'muted';
}

export interface Receipt {
  title: string;
  lines: ReceiptLine[];
  tone?: 'pos' | 'neg';
}

export interface Choice {
  id: string;
  label: string;
  /** Sent back as the next utterance when clicked. */
  value: string;
}

export type ActionStatus = 'done' | 'needs_info' | 'cancelled' | 'error';

export interface ActionOutcome {
  type: string;
  status: ActionStatus;
  message: string;
  txnId?: string;
}

export interface TurnResult {
  reply: string;
  /** Short version suited to being spoken aloud. */
  speak: string;
  intent: string;
  confidence: number;
  engine: 'local' | 'evon';
  actions: ActionOutcome[];
  choices: Choice[];
  receipt?: Receipt;
  pendingQuestion?: string;
  transcript: string;
  warnings: string[];
  state: ShopState;
  summary: DaySummary;
}

export interface Bootstrap {
  state: ShopState;
  summary: DaySummary;
  examples: string[];
  integrations: {
    prisma: boolean;
    evon: boolean;
    timbre: boolean;
  };
}

export interface ChatMessage {
  id: string;
  role: 'shopkeeper' | 'saathi';
  text: string;
  at: string;
  intent?: string;
  confidence?: number;
  choices?: Choice[];
  receipt?: Receipt;
  source?: 'voice' | 'text';
  warnings?: string[];
}
