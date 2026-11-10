import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent, parse } from './parser';
import { createSeedState } from '../store';

const { items, customers } = createSeedState();
const read = (text: string) => parse(text, items, customers);

test('flagship line: two stock-ins in one breath', () => {
  const parsed = read('Aaj 20 kilo chawal aaya aur 5 kilo sugar');
  assert.equal(parsed.intent, 'stock_in');
  assert.equal(parsed.commands.length, 2);
  assert.equal(parsed.commands[0].item?.name, 'Chawal');
  assert.equal(parsed.commands[0].qty, 20);
  assert.equal(parsed.commands[1].item?.name, 'Sugar');
  assert.equal(parsed.commands[1].qty, 5);
  assert.deepEqual(parsed.commands[0].missing, []);
});

test('udhaar keeps the customer, item and quantity apart', () => {
  const parsed = read('Ramesh ko 2 kilo chawal udhaar diya');
  assert.equal(parsed.intent, 'credit');
  const command = parsed.commands[0];
  assert.equal(command.customer?.name, 'Ramesh');
  assert.equal(command.item?.name, 'Chawal');
  assert.equal(command.qty, 2);
  assert.equal(command.unit, 'kg');
  assert.deepEqual(command.missing, []);
});

test('sale reads a spoken bill amount', () => {
  const parsed = read('2 kilo cheeni 120 rupaye mein bech di');
  assert.equal(parsed.intent, 'sale');
  assert.equal(parsed.commands[0].item?.name, 'Sugar');
  assert.equal(parsed.commands[0].qty, 2);
  assert.equal(parsed.commands[0].amount, 120);
});

test('Hindi transcript still finds the existing khata name', () => {
  const parsed = read('रमेश को 2 किलो चावल उधार दिया');
  const command = parsed.commands[0];
  assert.equal(command.customer?.name, 'Ramesh');
  assert.equal(command.item?.name, 'Chawal');
  assert.equal(command.qty, 2);
});

test('payment is not confused with udhaar', () => {
  const parsed = read('Ramesh ne 500 rupaye diye');
  assert.equal(parsed.intent, 'payment');
  assert.equal(parsed.commands[0].amount, 500);
  assert.equal(parsed.commands[0].customer?.name, 'Ramesh');
});

test('money-only udhaar needs no item', () => {
  const parsed = read('Ramesh ko 500 udhaar diya');
  assert.equal(parsed.intent, 'credit');
  assert.equal(parsed.commands[0].amount, 500);
  assert.equal(parsed.commands[0].item, undefined);
  assert.deepEqual(parsed.commands[0].missing, []);
});

test('queries are separated: summary, stock, low stock, khata', () => {
  assert.equal(detectIntent('Aaj kitni sale hui?').intent, 'summary');
  assert.equal(detectIntent('Chawal kitna bacha hai?').intent, 'stock_query');
  assert.equal(detectIntent('Kya khatam ho raha hai?').intent, 'low_stock');
  assert.equal(detectIntent('Ramesh ka kitna udhaar hai?').intent, 'khata_query');
  assert.equal(detectIntent('Chawal ka rate 65 karo').intent, 'set_price');
  assert.equal(detectIntent('Galti ho gayi, undo karo').intent, 'undo');
});

test('missing quantity becomes a question, not a guess', () => {
  const parsed = read('Chawal aaya');
  assert.equal(parsed.intent, 'stock_in');
  assert.deepEqual(parsed.commands[0].missing, ['qty']);
});

test('ASR spelling slips are repaired but marked', () => {
  const parsed = read('10 kilo chawall aaya');
  assert.equal(parsed.commands[0].item?.name, 'Chawal');
  assert.equal(parsed.commands[0].itemMatches[0].fuzzy, true);
  assert.ok(parsed.commands[0].warnings.some((warning) => warning.includes('maan')));
});

test('Hindi number words, fractions and Devanagari', () => {
  assert.equal(read('paanch kilo cheeni aayi').commands[0].qty, 5);
  assert.equal(read('dedh kilo ghee aaya').commands[0].qty, 1.5);
  const hindi = read('बीस किलो चावल आया');
  assert.equal(hindi.intent, 'stock_in');
  assert.equal(hindi.commands[0].item?.name, 'Chawal');
  assert.equal(hindi.commands[0].qty, 20);
});

test('a customer is never mistaken for an item or a stopword', () => {
  const parsed = read('aaj ka hisaab sunao');
  assert.equal(parsed.intent, 'summary');
  assert.equal(parsed.commands[0].customerName, undefined);
});
