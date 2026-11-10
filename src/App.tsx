import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import type { ChatMessage, DaySummary, ShopState } from '../shared/types';
import {
  fetchBootstrap,
  fetchState,
  getApiBase,
  isNativeApp,
  resetShop,
  saveApiBase,
  sendTurn,
} from './lib/api';
import {
  loadCache,
  loadQueue,
  offlineTurn,
  queueOp,
  saveCache,
  saveQueue,
  type OfflineOp,
} from './lib/offline';
import { parseAppLink } from './lib/pairing';
import { useSpeech, useVoice } from './lib/useVoice';
import { initials } from './lib/format';
import { Conversation } from './components/Conversation';
import { DiaryCard, KhataCard, StockCard, TodayCard } from './components/Dashboard';
import { PhonePairing } from './components/PhonePairing';
import { ServerSetup } from './components/ServerSetup';
import { ShopMark } from './components/Icons';

interface IntegrationStatus {
  prisma: boolean;
  evon: boolean;
  timbre: boolean;
}

const NO_INTEGRATIONS: IntegrationStatus = { prisma: false, evon: false, timbre: false };

function newSessionId(): string {
  return `s_${Math.random().toString(36).slice(2, 10)}`;
}

function messageId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `m_${Math.random().toString(36).slice(2, 10)}`;
}

function welcome(owner: string): ChatMessage {
  const firstName = owner.split(' ')[0] || 'ji';
  return {
    id: messageId(),
    role: 'saathi',
    at: new Date().toISOString(),
    text: `Namaste ${firstName} ji! Main aapki dukaan ka hisaab rakhta hoon. Bol kar bataiye — maal aaya, sale hui, ya kisi ko udhaar diya. Stock, khata aur aaj ka hisaab main khud sambhal loonga.`,
  };
}

function textMessage(text: string): ChatMessage {
  return { id: messageId(), role: 'saathi', at: new Date().toISOString(), text };
}

export default function App() {
  const native = isNativeApp();
  const [initialCache] = useState(() => loadCache(getApiBase()));
  const [apiBase, setApiBase] = useState(getApiBase);
  const [serverOpen, setServerOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [sessionId, setSessionId] = useState(newSessionId);
  const [state, setState] = useState<ShopState | null>(initialCache?.state ?? null);
  const [summary, setSummary] = useState<DaySummary | null>(initialCache?.summary ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [examples, setExamples] = useState<string[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus>(NO_INTEGRATIONS);
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [speakOn, setSpeakOn] = useState(true);
  const [offline, setOffline] = useState(false);
  const [queue, setQueue] = useState<OfflineOp[]>(() =>
    native ? loadQueue(getApiBase()) : [],
  );
  const [syncing, setSyncing] = useState(false);
  const busyRef = useRef(false);
  const syncRef = useRef(false);
  const pendingListenRef = useRef(false);
  const voiceStartRef = useRef<() => void>(() => undefined);
  const readyForVoiceRef = useRef(false);
  readyForVoiceRef.current = !booting && Boolean(state);

  const { speak } = useSpeech(speakOn, integrations.timbre);

  const pushReply = useCallback((text: string) => {
    setMessages((previous) => [...previous, textMessage(text)]);
  }, []);

  const connectServer = useCallback((base: string) => {
    saveApiBase(base);
    setServerOpen(false);
    setApiBase(getApiBase());
    setQueue(loadQueue(getApiBase()));
    setBootError(null);
    setOffline(false);
    setBooting(true);
  }, []);

  const syncOutbox = useCallback(async (session: string = sessionId) => {
    if (syncRef.current) return;
    const base = getApiBase();
    const pending = loadQueue(base);
    if (!pending.length) {
      setQueue([]);
      return;
    }
    syncRef.current = true;
    setSyncing(true);
    let applied = 0;
    let latest: { state: ShopState; summary: DaySummary } | null = null;
    const notices: string[] = [];

    for (const op of pending) {
      try {
        const turn = await sendTurn(op.text, session, op.source, {
          opId: op.id,
          occurredAt: op.at,
        });
        latest = { state: turn.state, summary: turn.summary };
        applied += 1;
        // A replay can still end in a question (for example a fuzzy item
        // match). Surface it instead of silently claiming the entry was saved.
        if (turn.actions.length === 0) notices.push(turn.reply);
        saveQueue(base, loadQueue(base).filter((row) => row.id !== op.id));
        setQueue(loadQueue(base));
      } catch {
        setOffline(true);
        break;
      }
    }

    if (latest) {
      setState(latest.state);
      setSummary(latest.summary);
      saveCache(base, latest.state, latest.summary);
      setOffline(false);
      setBootError(null);
    }
    if (applied > 0) {
      pushReply(
        `${applied} offline ${applied === 1 ? 'entry' : 'entries'} sync ho gayi${applied === 1 ? '' : 'in'} — ab sab server par save hai.`,
      );
    }
    for (const notice of notices) pushReply(notice);
    syncRef.current = false;
    setSyncing(false);
  }, [pushReply, sessionId]);

  const syncOutboxRef = useRef(syncOutbox);
  syncOutboxRef.current = syncOutbox;

  const tryReconnect = useCallback(async () => {
    if (native && !apiBase) return;
    try {
      const fresh = await fetchState();
      setState(fresh.state);
      setSummary(fresh.summary);
      saveCache(getApiBase(), fresh.state, fresh.summary);
      setOffline(false);
      setBootError(null);
      if (loadQueue(getApiBase()).length > 0) await syncOutbox();
    } catch {
      setOffline(true);
    }
  }, [apiBase, native, syncOutbox]);

  useEffect(() => {
    if (native && !apiBase) {
      setBooting(false);
      return;
    }
    let cancelled = false;
    fetchBootstrap()
      .then((boot) => {
        if (cancelled) return;
        setSessionId(boot.sessionId);
        setState(boot.state);
        setSummary(boot.summary);
        setExamples(boot.examples);
        setIntegrations(boot.integrations);
        setMessages([welcome(boot.state.shop.owner)]);
        setOffline(false);
        setBootError(null);
        saveCache(getApiBase(), boot.state, boot.summary);
        if (!native) setQueue(loadQueue(getApiBase()));
        void syncOutboxRef.current(boot.sessionId);
      })
      .catch(() => {
        if (cancelled) return;
        const cached = loadCache(getApiBase());
        setOffline(true);
        if (cached) {
          setState(cached.state);
          setSummary(cached.summary);
          setMessages([
            welcome(cached.state.shop.owner),
            textMessage(
              'Server se connection nahi hai — phone par saved hisaab dikha rahe hain. Sale, udhaar aur stock likh sakte hain; connection aate hi sync ho jayega.',
            ),
          ]);
          setBootError('Offline mode: server se connection nahi hai. Nayi entries phone par safe hain.');
        } else {
          setBootError(
            native
              ? 'Server se connection nahi bana. Server address check karein aur dono ko ek hi Wi-Fi par rakhein.'
              : 'Server se connection nahi bana. Terminal mein `npm run dev` chalayein.',
          );
          setMessages([
            textMessage(
              native
                ? 'Main abhi dukaan server tak nahi pahunch paya. Neeche “Server” se address check karein.'
                : 'Main abhi server tak nahi pahunch paya. `npm run dev` chalne ke baad page refresh karein.',
            ),
          ]);
        }
        setQueue(loadQueue(getApiBase()));
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, native]);

  useEffect(() => {
    if (!(offline || queue.length > 0)) return;
    const tick = () => {
      void tryReconnect();
    };
    const timer = window.setInterval(tick, 15000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [offline, queue.length, tryReconnect]);

  const handleAppLink = useCallback((raw?: string | null) => {
    const link = parseAppLink(raw ?? '');
    if (!link) return;
    if (link.type === 'pair') {
      saveApiBase(link.server);
      setApiBase(getApiBase());
      setQueue(loadQueue(getApiBase()));
      setBootError(null);
      setOffline(false);
      setBooting(true);
      return;
    }
    if (readyForVoiceRef.current) {
      window.setTimeout(() => voiceStartRef.current(), 400);
    } else {
      pendingListenRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    void CapApp.getLaunchUrl().then((result) => {
      if (!disposed) handleAppLink(result?.url);
    });
    const listener = CapApp.addListener('appUrlOpen', (event) => handleAppLink(event.url));
    return () => {
      disposed = true;
      void listener.then((handle) => handle.remove());
    };
  }, [handleAppLink, native]);

  useEffect(() => {
    if (pendingListenRef.current && !booting && state) {
      pendingListenRef.current = false;
      window.setTimeout(() => voiceStartRef.current(), 500);
    }
  }, [booting, state]);

  const send = useCallback(
    async (raw: string, source: 'voice' | 'text' = 'text') => {
      const text = raw.trim();
      if (!text || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setMessages((previous) => [
        ...previous,
        {
          id: messageId(),
          role: 'shopkeeper',
          text,
          at: new Date().toISOString(),
          source,
        },
      ]);

      try {
        if (loadQueue(getApiBase()).length > 0) await syncOutbox();
        const turn = await sendTurn(text, sessionId, source);
        setState(turn.state);
        setSummary(turn.summary);
        saveCache(getApiBase(), turn.state, turn.summary);
        setOffline(false);
        setMessages((previous) => [
          ...previous,
          {
            id: messageId(),
            role: 'saathi',
            text: turn.reply,
            at: new Date().toISOString(),
            intent: turn.intent,
            confidence: turn.confidence,
            choices: turn.choices,
            receipt: turn.receipt,
            warnings: turn.warnings,
          },
        ]);
        void speak(turn.speak);
      } catch {
        const cached = state ?? loadCache(getApiBase())?.state ?? null;
        const local = cached ? offlineTurn(text, cached, source) : null;
        if (local) {
          setState(local.result.state);
          setSummary(local.result.summary);
          saveCache(getApiBase(), local.result.state, local.result.summary);
          setOffline(true);
          if (local.queue) {
            const op: OfflineOp = {
              id: messageId(),
              text,
              at: new Date().toISOString(),
              source,
            };
            setQueue(queueOp(getApiBase(), op));
          }
          setMessages((previous) => [
            ...previous,
            {
              id: messageId(),
              role: 'saathi',
              text: local.result.reply,
              at: new Date().toISOString(),
              intent: local.result.intent,
              confidence: local.result.confidence,
              choices: local.result.choices,
              receipt: local.result.receipt,
              warnings: local.result.warnings,
            },
          ]);
          void speak(local.result.speak);
        } else {
          setOffline(true);
          pushReply(
            'Server se baat nahi ban rahi. Poora vivaran bol kar bhejein — jaise "Ramesh ko 2 kilo chawal udhaar diya" — main phone par save kar loonga.',
          );
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [pushReply, sessionId, speak, state, syncOutbox],
  );

  const onVoiceFinal = useCallback(
    (text: string) => {
      void send(text, 'voice');
    },
    [send],
  );

  const voice = useVoice(onVoiceFinal);
  voiceStartRef.current = voice.start;

  const reset = useCallback(async () => {
    const confirmed = window.confirm(
      'Demo reset karein? Saari nayi entries hat jayengi aur shuru wala stock/khata wapas aa jayega.',
    );
    if (!confirmed) return;
    try {
      const fresh = await resetShop();
      setState(fresh.state);
      setSummary(fresh.summary);
      saveCache(getApiBase(), fresh.state, fresh.summary);
      saveQueue(getApiBase(), []);
      setQueue([]);
      setOffline(false);
      setSessionId(newSessionId());
      setMessages([welcome(fresh.state.shop.owner)]);
      setBootError(null);
    } catch {
      setBootError('Reset nahi ho paya — server check karein.');
    }
  }, []);

  const ask = useCallback(
    (question: string) => {
      void send(question, 'text');
    },
    [send],
  );

  const lowCount = summary?.lowStock.length ?? 0;
  const engineLabel = integrations.evon ? 'Evon + local fallback' : 'Local Hinglish engine';

  if (native && !apiBase) {
    return <ServerSetup currentBase="" onConnected={connectServer} />;
  }

  return (
    <div className="app">
      <div className="grain" aria-hidden="true" />

      <header className="topbar">
        <div className="brand">
          <ShopMark />
          <div className="brand-text">
            <h1>दुकान साथी</h1>
            <p>Dukaan Saathi · bol kar dukaan chalao</p>
          </div>
        </div>

        <div className="topbar-right">
          {state && (
            <div className="shop-chip">
              <div className="shop-meta">
                <span className="shop-name">{state.shop.name}</span>
                <span className="shop-sub">
                  {state.shop.owner} · {state.shop.city}
                </span>
              </div>
              <span className="shop-avatar">{initials(state.shop.owner)}</span>
            </div>
          )}
        </div>
      </header>

      {(offline || queue.length > 0) && (
        <div className={`offline-banner${offline ? ' is-offline' : ''}`} role="status">
          <span>
            <strong>{offline ? 'Offline' : 'Sync baaki'}</strong>{' '}
            {queue.length > 0
              ? `${queue.length} ${queue.length === 1 ? 'entry' : 'entries'} phone par safe hain.`
              : 'Phone par saved hisaab dikha rahe hain.'}
          </span>
          <button type="button" onClick={() => void tryReconnect()} disabled={syncing}>
            {syncing ? 'Sync ho raha…' : offline ? 'Server dhoondhein' : 'Ab sync karein'}
          </button>
        </div>
      )}

      {bootError && (
        <div className="boot-error" role="alert">
          <strong>{offline ? 'Offline mode.' : 'Dukaan abhi band hai.'}</strong> {bootError}
        </div>
      )}

      <main className="layout">
        <Conversation
          messages={messages}
          busy={busy || (booting && !state)}
          examples={examples}
          onSend={(value) => ask(value)}
          speakOn={speakOn}
          onToggleSpeak={() => setSpeakOn((previous) => !previous)}
          voice={voice}
          engineLabel={engineLabel}
        />

        <aside className="rail">
          <TodayCard summary={summary} onAsk={ask} />
          <StockCard items={state?.items ?? []} lowCount={lowCount} onAsk={ask} />
          <KhataCard
            customers={state?.customers ?? []}
            outstanding={summary?.udhaarOutstanding ?? 0}
            onAsk={ask}
          />
          <DiaryCard txns={state?.txns ?? []} />
        </aside>
      </main>

      <footer className="statusbar">
        <div className="integration-status">
          <span className="intg">
            <i className={integrations.prisma ? 'on' : ''} /> Prisma{' '}
            {integrations.prisma ? 'live' : 'local'}
          </span>
          <span className="intg">
            <i className={integrations.evon ? 'on' : ''} /> Evon{' '}
            {integrations.evon ? 'live' : 'local'}
          </span>
          <span className="intg">
            <i className={integrations.timbre ? 'on' : ''} /> Timbre{' '}
            {integrations.timbre ? 'live' : 'local'}
          </span>
        </div>
        <div className="statusbar-right">
          <span className="engine-note">Voice-first · Hinglish · offline fallback</span>
          {native && (
            <button type="button" className="reset-link" onClick={() => setServerOpen(true)}>
              Server · {apiBase.replace(/^https?:\/\//, '')}
            </button>
          )}
          {!native && (
            <button type="button" className="reset-link" onClick={() => setPairOpen(true)}>
              Phone jodiye
            </button>
          )}
          <button type="button" className="reset-link" onClick={reset}>
            Demo reset
          </button>
        </div>
      </footer>

      {!native && pairOpen && <PhonePairing onClose={() => setPairOpen(false)} />}

      {native && serverOpen && (
        <ServerSetup
          currentBase={apiBase}
          canCancel
          onConnected={connectServer}
          onCancel={() => setServerOpen(false)}
        />
      )}
    </div>
  );
}
