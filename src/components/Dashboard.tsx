import type { Customer, DaySummary, Item, Txn } from '../../shared/types';
import { clock, initials, qty, rupees, todayLabel, txnLabel } from '../lib/format';
import { ArrowIcon } from './Icons';

interface AskableProps {
  onAsk: (question: string) => void;
}

function Empty({ children }: { children: string }) {
  return <p className="empty">{children}</p>;
}

export function TodayCard({ summary, onAsk }: { summary: DaySummary | null } & AskableProps) {
  if (!summary) {
    return (
      <article className="card today-card">
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-hero" />
      </article>
    );
  }
  const cashShare = summary.salesTotal > 0 ? summary.cashSales / summary.salesTotal : 0;
  return (
    <article className="card today-card">
      <div className="card-head">
        <div>
          <span className="eyebrow">Aaj ka hisaab</span>
          <h3>{todayLabel()}</h3>
        </div>
        <span className="count-pill">{summary.billCount} bills</span>
      </div>

      <div className="hero-figure">
        <span className="hero-label">Kul sale</span>
        <strong>{rupees(summary.salesTotal)}</strong>
        <span className="hero-sub">
          Cash {rupees(summary.cashSales)} · Udhaar {rupees(summary.creditGiven)}
        </span>
      </div>

      <div className="cash-split">
        <div className="split-bar" aria-hidden="true">
          <span className="cash" style={{ width: `${Math.round(cashShare * 100)}%` }} />
          <span className="credit" style={{ width: `${Math.round((1 - cashShare) * 100)}%` }} />
        </div>
        <div className="split-legend">
          <span>
            <i className="swatch cash" /> Cash
          </span>
          <span>
            <i className="swatch credit" /> Udhaar
          </span>
        </div>
      </div>

      <dl className="mini-stats">
        <div>
          <dt>Cash mila</dt>
          <dd>{rupees(summary.cashReceived)}</dd>
        </div>
        <div>
          <dt>Udhaar baaki</dt>
          <dd>{rupees(summary.udhaarOutstanding)}</dd>
        </div>
        <div>
          <dt>Sabse zyada</dt>
          <dd>
            {summary.topItem ? summary.topItem.name : '—'}
            {summary.topItem && (
              <em>{qty(summary.topItem.qty, summary.topItem.unit)}</em>
            )}
          </dd>
        </div>
      </dl>

      <button className="ask-link" type="button" onClick={() => onAsk('Aaj kitni sale hui?')}>
        Poora hisaab suniye <ArrowIcon />
      </button>
    </article>
  );
}

function statusOf(item: Item): { key: 'out' | 'low' | 'ok'; label: string } {
  if (item.stock <= 0) return { key: 'out', label: 'Khatam' };
  if (item.stock <= item.lowStockAt) return { key: 'low', label: 'Kam' };
  return { key: 'ok', label: 'Theek' };
}

export function StockCard({
  items,
  lowCount,
  onAsk,
}: { items: Item[]; lowCount: number } & AskableProps) {
  const sorted = [...items].sort(
    (a, b) => a.stock / Math.max(a.lowStockAt, 1) - b.stock / Math.max(b.lowStockAt, 1),
  );
  return (
    <article className="card stock-card">
      <div className="card-head">
        <div>
          <span className="eyebrow">Almari</span>
          <h3>Stock</h3>
        </div>
        {lowCount > 0 ? (
          <span className="count-pill alert">{lowCount} kam</span>
        ) : (
          <span className="count-pill">sab theek</span>
        )}
      </div>

      <div className="stock-list">
        {sorted.slice(0, 6).map((item) => {
          const status = statusOf(item);
          const ceiling = Math.max(item.lowStockAt * 3, item.stock, 1);
          const width = Math.max(0, Math.min(100, (item.stock / ceiling) * 100));
          return (
            <button
              key={item.id}
              type="button"
              className="stock-row"
              onClick={() => onAsk(`${item.name} kitna bacha hai?`)}
            >
              <span className="stock-line">
                <span className="stock-name">
                  {item.name} <em>{item.nameHi}</em>
                </span>
                <span className="stock-fig">{qty(item.stock, item.unit)}</span>
              </span>
              <span className="meter" aria-hidden="true">
                <span className={`fill ${status.key}`} style={{ width: `${width}%` }} />
              </span>
              <span className="stock-sub">
                <span className={`status ${status.key}`}>{status.label}</span>
                <span>
                  {rupees(item.price)}/{item.unit}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <button className="ask-link" type="button" onClick={() => onAsk('Sabka stock kitna hai?')}>
        Poora stock dekhiye <ArrowIcon />
      </button>
    </article>
  );
}

export function KhataCard({
  customers,
  outstanding,
  onAsk,
}: { customers: Customer[]; outstanding: number } & AskableProps) {
  const sorted = [...customers].sort((a, b) => b.balance - a.balance).slice(0, 5);
  return (
    <article className="card khata-card">
      <div className="card-head">
        <div>
          <span className="eyebrow">Udhaar</span>
          <h3>Khata</h3>
        </div>
        <span className="count-pill">{rupees(outstanding)}</span>
      </div>

      {sorted.length === 0 ? (
        <Empty>Abhi kisi ka khata nahi hai.</Empty>
      ) : (
        <ul className="khata-list">
          {sorted.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                className="khata-row"
                onClick={() => onAsk(`${customer.name} ka kitna udhaar hai?`)}
              >
                <span className={`avatar${customer.balance > 0 ? ' owes' : ''}`}>
                  {initials(customer.name)}
                </span>
                <span className="khata-name">
                  {customer.name}
                  <em>
                    {customer.balance > 0
                      ? 'udhaar baaki'
                      : customer.balance < 0
                        ? 'advance jama'
                        : 'khata clear'}
                  </em>
                </span>
                <span className={`khata-amount${customer.balance > 0 ? ' owes' : ''}`}>
                  {customer.balance < 0
                    ? `+${rupees(Math.abs(customer.balance))}`
                    : rupees(customer.balance)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button className="ask-link" type="button" onClick={() => onAsk('Sabka udhaar kitna hai?')}>
        Sabka khata <ArrowIcon />
      </button>
    </article>
  );
}

function diaryTitle(txn: Txn): string {
  if (txn.type === 'payment') return `${txn.customerName ?? 'Grahak'} ne diya`;
  if (txn.type === 'credit') return `${txn.customerName ?? 'Grahak'} ko udhaar`;
  if (txn.type === 'stock_in') return `${txn.itemName ?? 'Maal'} aaya`;
  if (txn.type === 'sale') return `${txn.itemName ?? 'Sale'} becha`;
  if (txn.type === 'price') return `${txn.itemName ?? 'Item'} ka rate`;
  return 'Entry';
}

function diaryDetail(txn: Txn): string {
  if (txn.type === 'payment' || txn.type === 'price') return txn.note ?? '';
  if (txn.qty !== undefined && txn.itemName) return qty(txn.qty, txn.unit ?? '');
  return txn.note ?? '';
}

export function DiaryCard({ txns }: { txns: Txn[] }) {
  const recent = [...txns].reverse().slice(0, 6);
  return (
    <article className="card diary-card">
      <div className="card-head">
        <div>
          <span className="eyebrow">Aaj ki diary</span>
          <h3>Entries</h3>
        </div>
        <span className="count-pill">{txns.length}</span>
      </div>

      {recent.length === 0 ? (
        <Empty>Koi entry nahi hui. Bol kar shuru kijiye.</Empty>
      ) : (
        <ul className="diary-list">
          {recent.map((txn) => {
            const isCredit = txn.type === 'credit';
            const isIn = txn.type === 'sale' || txn.type === 'payment';
            return (
              <li key={txn.id}>
                <span className={`diary-dot ${txn.type}`} aria-hidden="true" />
                <span className="diary-body">
                  <span className="diary-title">{diaryTitle(txn)}</span>
                  <span className="diary-meta">
                    {txnLabel(txn.type)} · {clock(txn.ts)}
                    {diaryDetail(txn) ? ` · ${diaryDetail(txn)}` : ''}
                  </span>
                </span>
                {txn.amount !== undefined && (
                  <span
                    className={`diary-amount${isIn ? ' in' : ''}${isCredit ? ' out' : ''}`}
                  >
                    {isCredit ? '−' : isIn ? '+' : ''}
                    {rupees(txn.amount)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
