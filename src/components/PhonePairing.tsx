import { useEffect, useState } from 'react';
import type { PairInfo } from '../lib/api';
import { fetchPairing } from '../lib/api';

interface PhonePairingProps {
  onClose: () => void;
}

/**
 * Shown on the laptop. The QR is a `dukaansaathi://pair?server=…` link, so the
 * phone's normal camera app opens Dukaan Saathi already connected.
 */
export function PhonePairing({ onClose }: PhonePairingProps) {
  const [info, setInfo] = useState<PairInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPairing()
      .then((pair) => {
        if (!cancelled) setInfo(pair);
      })
      .catch(() => {
        if (!cancelled) setError('Pairing link nahi ban paya. Server chal raha hai?');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const copy = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.server);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Copy nahi hua — address haath se likhein.');
    }
  };

  return (
    <div className="connect" role="dialog" aria-modal="true" aria-labelledby="pair-title">
      <div className="connect-card pair-card">
        <div className="connect-brand">
          <div>
            <span className="eyebrow">Android app</span>
            <h2 id="pair-title">Phone jodiye</h2>
          </div>
        </div>

        <p className="connect-copy">
          Phone ke camera se yeh QR scan karein. App khul kar khud server se jud jayegi — address
          type karne ki zaroorat nahi. Dono ek hi Wi-Fi par hone chahiye.
        </p>

        {info ? (
          <>
            <div
              className="pair-qr"
              // Server-generated SVG of the deep link, not user content.
              dangerouslySetInnerHTML={{ __html: info.svg }}
            />
            <div className="pair-url">
              <code>{info.server}</code>
              <button type="button" onClick={copy}>
                {copied ? 'Copy ho gaya' : 'Copy'}
              </button>
            </div>
          </>
        ) : (
          <div className="pair-loading">{error ?? 'QR ban raha hai…'}</div>
        )}

        {error && info && <p className="connect-error">{error}</p>}

        <div className="connect-help">
          <span className="eyebrow">QR scan nahi ho raha?</span>
          <p>
            App mein <strong>Server</strong> kholkar upar wala address daal dein. Laptop par{' '}
            <code>npm run dev</code> chalte rehna chahiye.
          </p>
        </div>

        <button type="button" className="connect-cancel" onClick={onClose}>
          Band karein
        </button>
      </div>
    </div>
  );
}
