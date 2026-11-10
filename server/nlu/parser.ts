import type { Customer, Item, Unit } from '../../shared/types';
import {
  INTENT_KEYWORDS,
  MONEY_WORDS,
  NAME_STOPWORDS,
  NUMBER_WORDS,
  UNIT_FACTORS,
  UNIT_WORDS,
  type Intent,
} from './lexicon';
import { normalize, similarity, tokens } from './normalize';

export type MissingSlot = 'item' | 'qty' | 'customer' | 'amount' | 'new_item';

export interface ItemMatch {
  item: Item;
  score: number;
  index: number;
  alias: string;
  fuzzy: boolean;
}

export interface ParsedCommand {
  intent: Intent;
  confidence: number;
  text: string;
  item?: Item;
  itemMatches: ItemMatch[];
  qty?: number;
  unit?: Unit;
  amount?: number;
  price?: number;
  customer?: Customer;
  customerName?: string;
  newItemName?: string;
  newItemUnit?: Unit;
  missing: MissingSlot[];
  warnings: string[];
}

export interface ParsedUtterance {
  intent: Intent;
  confidence: number;
  commands: ParsedCommand[];
  text: string;
}

const QUERY_INTENTS = new Set<Intent>(['summary', 'stock_query', 'low_stock', 'khata_query']);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordBoundary(alias: string): RegExp {
  const body = escapeRegExp(alias);
  // Devanagari and Latin both; digits count as word characters so "sugar2" won't match.
  return new RegExp(`(?:^|[^a-z0-9\\u0900-\\u097F])${body}(?=$|[^a-z0-9\\u0900-\\u097F])`, 'i');
}

/** All items that appear in a clause, best match first. */
export function findItemMatches(clause: string, items: Item[]): ItemMatch[] {
  const text = normalize(clause);
  const exact: ItemMatch[] = [];

  for (const item of items) {
    for (const alias of item.aliases) {
      const needle = normalize(alias);
      const match = wordBoundary(needle).exec(text);
      if (match) {
        exact.push({
          item,
          alias,
          score: 10 + needle.length,
          index: match.index,
          fuzzy: false,
        });
        break; // One direct hit per item is enough.
      }
    }
  }

  if (exact.length) {
    return exact.sort((a, b) => a.index - b.index || b.score - a.score);
  }

  // Nothing exact: try to repair ASR spelling before giving up.
  const fuzzy: ItemMatch[] = [];
  const seen = new Set<string>();
  for (const token of tokens(text)) {
    // Short words are too easy to collide with verbs ("diya" ~ "dal").
    if (token.length < 5 || NUMBER_WORDS[token] !== undefined) continue;
    if (NAME_STOPWORDS.has(token)) continue;
    let best: { item: Item; alias: string; score: number } | undefined;
    for (const item of items) {
      for (const alias of item.aliases) {
        if (!/^[a-z]{4,}$/.test(alias)) continue;
        if (token[0] !== alias[0]) continue;
        const score = similarity(token, alias);
        if (score >= 0.82 && (!best || score > best.score)) {
          best = { item, alias, score };
        }
      }
    }
    if (best && !seen.has(best.item.id)) {
      seen.add(best.item.id);
      fuzzy.push({
        item: best.item,
        alias: best.alias,
        score: best.score * 6,
        index: text.indexOf(token),
        fuzzy: true,
      });
    }
  }
  return fuzzy.sort((a, b) => b.score - a.score);
}

/** "paanch sau" → 500, "do sau pachas" → 250, "dedh" → 1.5 */
function numberSequence(words: string[]): { value: number; length: number } | null {
  let total = 0;
  let current = 0;
  let length = 0;
  for (const word of words) {
    const value = NUMBER_WORDS[word];
    if (value === undefined) break;
    length += 1;
    if (value >= 100) {
      current = (current || 1) * value;
      total += current;
      current = 0;
    } else {
      current += value;
    }
  }
  if (!length) return null;
  return { value: Math.round((total + current) * 1000) / 1000, length };
}

interface QuantityHit {
  value: number;
  unitWord?: string;
  index: number;
  /** How many tokens the number itself spans. */
  span: number;
  viaMoney: boolean;
}

function extractQuantities(clause: string): QuantityHit[] {
  const words = tokens(clause);
  const hits: QuantityHit[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (/^\d+(?:\.\d+)?$/.test(word)) {
      const next = words[i + 1];
      const nextIsUnit = next !== undefined && UNIT_WORDS[next] !== undefined;
      const nextIsMoney = next !== undefined && MONEY_WORDS.includes(next);
      hits.push({
        value: Number(word),
        unitWord: nextIsUnit ? next : undefined,
        index: i,
        span: 1,
        viaMoney: nextIsMoney,
      });
      continue;
    }
    if (NUMBER_WORDS[word] === undefined) continue;

    // Consume the whole number phrase ("do sau pachas") before the unit.
    const sequence = numberSequence(words.slice(i, i + 4));
    if (sequence === null) continue;
    const bestLength = sequence.length;
    const bestValue = sequence.value;

    const afterIndex = i + bestLength;
    const after = words[afterIndex];
    const afterIsUnit = after !== undefined && UNIT_WORDS[after] !== undefined;
    const afterIsMoney = after !== undefined && MONEY_WORDS.includes(after);
    const isLoneDoOrEk =
      bestLength === 1 && (word === 'do' || word === 'doo' || word === 'ek' || word === 'ik');
    // "likh do" / "de do" are verbs, not quantities.
    if (isLoneDoOrEk && !afterIsUnit && !afterIsMoney) continue;

    hits.push({
      value: bestValue,
      unitWord: afterIsUnit ? after : undefined,
      index: i,
      span: bestLength,
      viaMoney: afterIsMoney,
    });
    i += bestLength - 1;
  }
  return hits;
}

function extractMoney(clause: string): number | undefined {
  const text = normalize(clause);
  const money = MONEY_WORDS.map(escapeRegExp).join('|');
  const prefixed = new RegExp(`(?:${money})\\s*(\\d+(?:\\.\\d+)?)`).exec(text);
  if (prefixed) return Number(prefixed[1]);
  const suffixed = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:${money})`).exec(text);
  if (suffixed) return Number(suffixed[1]);

  const words = tokens(text);
  for (let i = 0; i < words.length; i++) {
    if (!MONEY_WORDS.includes(words[i])) continue;
    for (let length = Math.min(4, i); length >= 1; length--) {
      const sequence = numberSequence(words.slice(i - length, i));
      if (sequence !== null && sequence.length === length) return sequence.value;
    }
  }
  return undefined;
}

function isNameToken(word: string, items: Item[]): boolean {
  if (!/^[a-z\u0900-\u097F]+$/.test(word)) return false;
  if (word.length < 3) return false;
  if (NAME_STOPWORDS.has(word)) return false;
  if (NUMBER_WORDS[word] !== undefined) return false;
  if (UNIT_WORDS[word] !== undefined) return false;
  for (const item of items) {
    for (const alias of item.aliases) {
      if (normalize(alias) === word) return false;
    }
  }
  return true;
}

function titleCase(value: string): string {
  return value
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

interface CustomerHit {
  name: string;
  customer?: Customer;
}

function extractCustomer(clause: string, items: Item[], customers: Customer[]): CustomerHit | undefined {
  const words = tokens(clause);
  const markers = new Set(['ko', 'ne', 'ka', 'ke', 'ki', 'se', 'को', 'ने', 'का', 'के', 'की', 'से']);
  const candidates: string[] = [];

  for (let i = 0; i < words.length; i++) {
    if (!markers.has(words[i])) continue;
    const parts: string[] = [];
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      if (!isNameToken(words[j], items)) break;
      parts.unshift(words[j]);
    }
    if (parts.length) candidates.push(parts.join(' '));
  }
  if (!candidates.length) return undefined;

  // Prefer an existing khata entry, tolerating spelling drift.
  let best: { name: string; customer: Customer; score: number } | undefined;
  for (const candidate of candidates) {
    for (const customer of customers) {
      const score = Math.max(
        similarity(candidate, customer.name),
        ...customer.name.split(' ').map((part) => similarity(candidate, part)),
        ...(customer.nameHi
          ? [
              similarity(candidate, customer.nameHi),
              ...customer.nameHi.split(' ').map((part) => similarity(candidate, part)),
            ]
          : []),
      );
      if (score >= 0.8 && (!best || score > best.score)) {
        best = { name: customer.name, customer, score };
      }
    }
  }
  if (best) return { name: best.name, customer: best.customer };
  return { name: titleCase(candidates[0]) };
}

interface IntentScore {
  intent: Intent;
  score: number;
}

export function detectIntent(raw: string): IntentScore {
  const text = normalize(raw);
  const words = text.split(' ');
  const scores = new Map<Intent, number>();

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS) as [Intent, readonly string[]][]) {
    let score = 0;
    for (const keyword of keywords) {
      const needle = normalize(keyword);
      if (!needle) continue;
      if (text.includes(needle)) {
        score += 1 + needle.length / 5;
        if (text === needle) score += 2;
      }
    }
    if (score > 0) scores.set(intent, score);
  }

  const questionish = /\?|kitna|kitni|kitne|kaun|kya|batao|sunao|hisaab|hisab|baki|bacha/.test(text);
  if (questionish) {
    for (const intent of QUERY_INTENTS) {
      const value = scores.get(intent);
      if (value) scores.set(intent, value * 1.6);
    }
  }

  // A single "haan" / "nahi" is an answer, not a command.
  if (words.length <= 2) {
    const affirm = INTENT_KEYWORDS.affirm.some((word) => text === normalize(word));
    const deny = INTENT_KEYWORDS.deny.some((word) => text === normalize(word));
    if (affirm) return { intent: 'affirm', score: 99 };
    if (deny) return { intent: 'deny', score: 99 };
  }

  let winner: IntentScore = { intent: 'unknown', score: 0 };
  for (const [intent, score] of scores) {
    if (score > winner.score + 1e-9) winner = { intent, score };
  }
  return winner;
}

function resolveQuantity(
  hit: QuantityHit,
  item: Item | undefined,
): { qty: number; unit: Unit; warning?: string } {
  if (hit.unitWord) {
    const factor = UNIT_FACTORS[hit.unitWord];
    if (factor) return { qty: hit.value * factor.factor, unit: factor.unit };
    const stated = UNIT_WORDS[hit.unitWord];
    if (item && stated !== item.unit) {
      return {
        qty: hit.value,
        unit: item.unit,
        warning: `${item.name} ${item.unit} mein hisaab hota hai — ${hit.value} ${item.unit} maan liya.`,
      };
    }
    return { qty: hit.value, unit: stated };
  }
  return { qty: hit.value, unit: item?.unit ?? 'piece' };
}

function parseClause(
  clause: string,
  intent: Intent,
  items: Item[],
  customers: Customer[],
): ParsedCommand {
  const text = normalize(clause);
  const itemMatches = findItemMatches(text, items);
  const item = itemMatches[0]?.item;
  const quantities = extractQuantities(text);
  const warningList: string[] = [];

  let qty: number | undefined;
  let unit: Unit | undefined;
  const measured = ['stock_in', 'sale', 'credit', 'payment'].includes(intent);
  // A unit-qualified number is a measurement in any intent; a bare number
  // needs a measurement intent and a known item before we trust it.
  const qtyHit = quantities.find(
    (hit) => !hit.viaMoney && (hit.unitWord !== undefined || (measured && item !== undefined)),
  );
  if (qtyHit) {
    const resolved = resolveQuantity(qtyHit, item);
    qty = resolved.qty;
    unit = resolved.unit;
    if (resolved.warning) warningList.push(resolved.warning);
  }

  let amount = extractMoney(text);
  if (amount === undefined) {
    const moneyWordHit = quantities.find((hit) => hit.viaMoney);
    if (moneyWordHit) amount = moneyWordHit.value;
  }
  if (amount === undefined) {
    // "500 ka udhaar", "300 mein bech diya" — a bare number is money when the
    // sentence is about a payment or a bill and nothing was measured.
    const bare = quantities.find((hit) => !hit.viaMoney && !hit.unitWord);
    const kaPattern = /\b(\d+(?:\.\d+)?)\s+(?:ka|ke|ki|mein|me)\b/.exec(text);
    if (
      bare &&
      ['payment', 'credit', 'sale', 'set_price', 'add_item'].includes(intent) &&
      (qtyHit === undefined || qtyHit.unitWord)
    ) {
      amount = bare.value;
    } else if (kaPattern && ['payment', 'credit', 'sale', 'set_price'].includes(intent)) {
      amount = Number(kaPattern[1]);
    }
  }

  const customerHit = extractCustomer(text, items, customers);
  const missing: MissingSlot[] = [];

  switch (intent) {
    case 'stock_in':
      if (!item) missing.push('item');
      if (qty === undefined) missing.push('qty');
      break;
    case 'sale':
      if (!item && amount === undefined) missing.push('item');
      if (qty === undefined && amount === undefined) missing.push('qty');
      break;
    case 'credit':
      if (!item && amount === undefined) missing.push('item');
      if (qty === undefined && amount === undefined) missing.push('qty');
      if (!customerHit) missing.push('customer');
      break;
    case 'payment':
      if (!customerHit) missing.push('customer');
      if (amount === undefined) missing.push('amount');
      break;
    case 'set_price':
      if (!item) missing.push('item');
      if (amount === undefined) missing.push('amount');
      break;
    case 'add_item': {
      const words = tokens(text);
      const marker = words.findIndex((word) => word === 'item' || word === 'saman' || word === 'product');
      const candidate = marker >= 0 ? words.slice(marker + 1).find((word) => isNameToken(word, items)) : undefined;
      if (!candidate) missing.push('new_item');
      if (amount === undefined) missing.push('amount');
      break;
    }
    default:
      break;
  }

  // Confidence: what we recognised, minus what we had to repair or assume.
  let confidence = 0.5;
  if (item) confidence += itemMatches[0].fuzzy ? 0.08 : 0.24;
  if (qty !== undefined) confidence += 0.12;
  if (amount !== undefined) confidence += 0.06;
  if (customerHit?.customer) confidence += 0.08;
  if (intent !== 'unknown') confidence += 0.06;
  if (itemMatches[0]?.fuzzy) {
    confidence -= 0.05;
    warningList.push(`"${itemMatches[0].alias}" hi maan raha hoon — sahi hai?`);
  }
  if (missing.length) confidence -= 0.12 * missing.length;
  confidence = Math.max(0.2, Math.min(0.97, confidence));

  return {
    intent,
    confidence: Math.round(confidence * 100) / 100,
    text,
    item,
    itemMatches,
    qty: qty === undefined ? undefined : Math.round(qty * 1000) / 1000,
    unit,
    amount,
    customer: customerHit?.customer,
    customerName: customerHit?.name,
    newItemName: intent === 'add_item' ? extractNewItemName(text, items) : undefined,
    newItemUnit: intent === 'add_item' ? extractNewItemUnit(text) : undefined,
    missing,
    warnings: warningList,
  };
}

function extractNewItemName(text: string, items: Item[]): string | undefined {
  const words = tokens(text);
  const marker = words.findIndex((word) => word === 'item' || word === 'saman' || word === 'product');
  if (marker < 0) return undefined;
  const candidate = words.slice(marker + 1).find((word) => isNameToken(word, items));
  return candidate ? titleCase(candidate) : undefined;
}

function extractNewItemUnit(text: string): Unit | undefined {
  for (const word of tokens(text)) {
    if (UNIT_WORDS[word]) return UNIT_WORDS[word];
  }
  return undefined;
}

export function parse(raw: string, items: Item[], customers: Customer[]): ParsedUtterance {
  const text = normalize(raw);
  const primary = detectIntent(text);
  const chunks = text
    .split(/\s+(?:aur|and|&)\s+|,\s*/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const commands: ParsedCommand[] = [];
  for (const chunk of chunks) {
    // A clause without its own verb ("...aur 5 kilo sugar") inherits the intent.
    const own = detectIntent(chunk);
    const intent: Intent =
      own.intent !== 'unknown' && own.score >= primary.score * 0.5 ? own.intent : primary.intent;
    const command = parseClause(chunk, intent, items, customers);
    const previous = commands[commands.length - 1];
    if (previous && command.intent === previous.intent) {
      if (!command.customer && previous.customer) {
        command.customer = previous.customer;
        command.customerName = previous.customerName;
        command.missing = command.missing.filter((slot) => slot !== 'customer');
      }
    }
    commands.push(command);
  }

  if (!commands.length) {
    commands.push(parseClause(text, primary.intent, items, customers));
  }

  // Query intents only need one command; don't repeat the same summary per clause.
  const usable = QUERY_INTENTS.has(primary.intent)
    ? commands.filter((command, index) => index === 0 || command.item || command.customerName)
    : commands;

  return {
    intent: primary.intent,
    confidence: QUERY_INTENTS.has(primary.intent)
      ? Math.min(0.95, (usable[0]?.confidence ?? 0.2) + 0.25)
      : (usable[0]?.confidence ?? 0.2),
    commands: usable.length ? usable : commands.slice(0, 1),
    text,
  };
}
