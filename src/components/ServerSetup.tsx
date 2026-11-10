import { useState, type FormEvent } from 'react';
import { normalizeApiBase, probeServer } from '../lib/api';
import { ShopMark } from './Icons';

interface ServerSetupProps {
  currentBase: string;
  canCancel?: boolean;
  onConnected: (base: string) => void;
  onCancel?: () => void;
}

/**
 * The native app is a thin shell around the shop server. On first launch (or
 * after switching networks) the shopkeeper points it at the laptop/PC running
 * Dukaan Saathi.
 */
export function ServerSetup({ currentBase, canCancel, onConnected, onCancel }: ServerSetupProps) {
  const [value, setValue] = useState(currentBase || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const base = normalizeApiBase(value);
    if (!base) {
      setError('Server ka address likhein, jaise http://192.168.1.5:8787');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const health = await probeServer(base);
      if (!health.ok) throw new Error('Server ne jawab nahi diya');
      onConnected(base);
    } catch {
      setError(
        'Server nahi mila. Laptop par `npm run dev` chalayein, dono ek hi Wi-Fi par rakhein, aur address check karein.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="connect" role="dialog" aria-modal="true" aria-labelledby="connect-title">
      <div className="connect-card">
        <div className="connect-brand">
          <ShopMark />
          <div>
            <span className="eyebrow">Dukaan Saathi</span>
            <h2 id="connect-title">Dukaan se jodiye</h2>
          </div>
        </div>

        <p className="connect-copy">
          App aapke laptop ya PC par chal rahe Dukaan Saathi server se baat karta hai. Dono ko ek
          hi Wi-Fi par rakhein.
        </p>

        <form onSubmit={submit} className="connect-form">
          <label htmlFor="server-url">Server address</label>
          <div className="connect-row">
            <input
              id="server-url"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="http://192.168.1.5:8787"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
            />
            <button type="submit" className="connect-submit" disabled={busy}>
              {busy ? 'Jod rahe…' : 'Jodiye'}
            </button>
          </div>
        </form>

        {error && (
          <p className="connect-error" role="alert">
            {error}
          </p>
        )}

        <div className="connect-help">
          <span className="eyebrow">Address kahan milega</span>
          <p>
            Laptop par <code>npm run dev</code> chalayein. Terminal mein{' '}
            <code>LAN → http://…</code> likha aata hai — wahi address yahan daalein.
          </p>
        </div>

        {canCancel && (
          <button type="button" className="connect-cancel" onClick={onCancel}>
            Wapas
          </button>
        )}
      </div>
    </div>
  );
}
