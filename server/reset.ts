import { resetState, computeSummary, dataFile } from './store';

const state = resetState();
const summary = computeSummary(state);
console.log(`Dukaan Saathi data reset → ${dataFile()}`);
console.log(
  `${state.items.length} items, ${state.customers.length} khata entries, ${state.txns.length} diary rows, aaj ki sale ₹${summary.salesTotal}`,
);
