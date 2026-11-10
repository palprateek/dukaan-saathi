import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataFile = path.join(os.tmpdir(), `dukaan-saathi-test-${process.pid}-${Date.now()}.json`);
process.env.DUKAAN_DATA_FILE = dataFile;

const { handleTurn } = await import('../engine');
const { resetState, loadState } = await import('../store');

test.after(() => {
  fs.rmSync(dataFile, { force: true });
});

const say = (text: string, sessionId: string) =>
  handleTurn({ text, sessionId, source: 'text' });

const item = (name: string) => loadState().items.find((row) => row.name === name)!;
const customer = (name: string) => loadState().customers.find((row) => row.name === name)!;

test('stock arrives and the shelf updates', async () => {
  resetState();
  const before = item('Chawal').stock;
  const turn = await say('Aaj 20 kilo chawal aaya', 'stock-1');
  assert.equal(turn.intent, 'stock_in');
  assert.equal(turn.actions[0].status, 'done');
  assert.equal(item('Chawal').stock, before + 20);
  assert.match(turn.reply, /20 kg/);
  assert.equal(turn.receipt?.title, 'Stock update');
});

test('two items in one sentence are two movements', async () => {
  resetState();
  const turn = await say('20 kilo chawal aaya aur 5 kilo sugar', 'stock-2');
  assert.equal(turn.actions.length, 2);
  assert.equal(item('Chawal').stock, 58);
  assert.equal(item('Sugar').stock, 17);
});

test('udhaar lands in the khata and reduces stock', async () => {
  resetState();
  const balance = customer('Ramesh').balance;
  const stock = item('Chawal').stock;
  const turn = await say('Ramesh ko 2 kilo chawal udhaar diya', 'credit-1');
  assert.equal(turn.intent, 'credit');
  assert.equal(customer('Ramesh').balance, balance + 120);
  assert.equal(item('Chawal').stock, stock - 2);
  assert.match(turn.reply, /khate mein/);
});

test('a sale is priced, recorded and subtracted', async () => {
  resetState();
  const turn = await say('2 kilo sugar 120 rupaye mein bech di', 'sale-1');
  assert.equal(turn.intent, 'sale');
  assert.equal(turn.summary.cashSales, 300);
  assert.equal(turn.summary.salesTotal, 390);
  assert.equal(item('Sugar').stock, 10);
});

test('vasooli reduces what a customer owes', async () => {
  resetState();
  const turn = await say('Imran ne 200 rupaye diye', 'pay-1');
  assert.equal(turn.intent, 'payment');
  assert.equal(customer('Imran').balance, 180);
  assert.match(turn.reply, /mila/);
});

test('a summary is read out, not invented', async () => {
  resetState();
  const turn = await say('Aaj kitni sale hui?', 'summary-1');
  assert.equal(turn.intent, 'summary');
  assert.match(turn.reply, /₹270/);
  assert.equal(turn.summary.billCount, 3);
  assert.ok(turn.receipt?.lines.length);
});

test('missing quantity asks a follow-up and then completes', async () => {
  resetState();
  const first = await say('Chawal aaya', 'ask-qty');
  assert.ok(first.pendingQuestion?.includes('kitna'));
  assert.equal(item('Chawal').stock, 38);

  const second = await say('10 kilo', 'ask-qty');
  assert.equal(second.pendingQuestion, undefined);
  assert.equal(item('Chawal').stock, 48);
});

test('stock shortfall is confirmed before it is written', async () => {
  resetState();
  const first = await say('Sunita ko 100 kilo chawal udhaar diya', 'guard-1');
  assert.match(first.pendingQuestion ?? '', /stock/i);
  assert.equal(customer('Sunita').balance, 0);

  const second = await say('nahi', 'guard-1');
  assert.match(second.reply, /cancel/i);
  assert.equal(customer('Sunita').balance, 0);
  assert.equal(item('Chawal').stock, 38);
});

test('a repaired item name is confirmed with a yes', async () => {
  resetState();
  const first = await say('10 kilo chawall aaya', 'fuzzy-1');
  assert.match(first.pendingQuestion ?? '', /Chawal/);
  const second = await say('haan', 'fuzzy-1');
  assert.equal(second.actions[0].status, 'done');
  assert.equal(item('Chawal').stock, 48);
});

test('undo takes back the last spoken entry', async () => {
  resetState();
  await say('2 kilo sugar bech di', 'undo-1');
  assert.equal(item('Sugar').stock, 10);
  const turn = await say('Galti ho gayi, undo karo', 'undo-1');
  assert.equal(turn.intent, 'undo');
  assert.equal(item('Sugar').stock, 12);
});

test('rate change is a first-class command', async () => {
  resetState();
  const turn = await say('Chawal ka rate 65 karo', 'price-1');
  assert.equal(turn.intent, 'set_price');
  assert.equal(item('Chawal').price, 65);
});

test('Devanagari speech still updates the shelf', async () => {
  resetState();
  const turn = await say('बीस किलो चावल आया', 'hindi-1');
  assert.equal(turn.intent, 'stock_in');
  assert.equal(item('Chawal').stock, 58);
});

test('low stock and khata are answered from real state', async () => {
  resetState();
  const low = await say('Kya khatam ho raha hai?', 'low-1');
  assert.equal(low.intent, 'low_stock');
  assert.equal(low.summary.lowStock.length, 3);

  const khata = await say('Sabka udhaar kitna hai?', 'khata-1');
  assert.equal(khata.intent, 'khata_query');
  assert.match(khata.reply, /Ramesh/);
});
