import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage, Choice, Receipt } from '../../shared/types';
import { clock } from '../lib/format';
import { MicIcon, SendIcon, SpeakerIcon, SpeakerOffIcon } from './Icons';

interface ConversationProps {
  messages: ChatMessage[];
  busy: boolean;
  examples: string[];
  onSend: (value: string) => void;
  speakOn: boolean;
  onToggleSpeak: () => void;
  voice: {
    supported: boolean;
    listening: boolean;
    interim: string;
    error: string | null;
    start: () => void;
    stop: () => void;
    clearError: () => void;
  };
  engineLabel: string;
}

const INTENT_LABELS: Record<string, string> = {
  stock_in: 'Stock',
  sale: 'Sale',
  credit: 'Udhaar',
  payment: 'Vasooli',
  summary: 'Hisaab',
  stock_query: 'Stock poochh',
  low_stock: 'Low stock',
  khata_query: 'Khata',
  set_price: 'Rate',
  add_item: 'Naya item',
  undo: 'Undo',
  help: 'Madad',
  greet: 'Namaste',
  affirm: 'Haan',
  deny: 'Nahi',
  unknown: 'Sawaal',
};

function ReceiptCard({ receipt }: { receipt: Receipt }) {
  return (
    <div className={`receipt${receipt.tone ? ` tone-${receipt.tone}` : ''}`}>
      <div className="receipt-head">
        <span>{receipt.title}</span>
        <span className="receipt-rule" aria-hidden="true" />
      </div>
      <ul>
        {receipt.lines.map((line, index) => (
          <li key={`${line.label}-${index}`} className={line.tone ?? undefined}>
            <span>{line.label}</span>
            <b>{line.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Choices({ choices, onSend }: { choices: Choice[]; onSend: (value: string) => void }) {
  return (
    <div className="choices">
      {choices.map((choice) => (
        <button key={choice.id} type="button" onClick={() => onSend(choice.value)}>
          {choice.label}
        </button>
      ))}
    </div>
  );
}

function Message({ message, onSend }: { message: ChatMessage; onSend: (value: string) => void }) {
  const isShopkeeper = message.role === 'shopkeeper';
  return (
    <div className={`msg ${isShopkeeper ? 'from-shop' : 'from-saathi'}`}>
      {!isShopkeeper && (
        <div className="msg-avatar" aria-hidden="true">
          द
        </div>
      )}
      <div className="msg-body">
        <div className="bubble">
          <p>{message.text}</p>
          {message.receipt && <ReceiptCard receipt={message.receipt} />}
          {message.warnings?.map((warning) => (
            <p className="warn" key={warning}>
              {warning}
            </p>
          ))}
        </div>
        <div className="msg-meta">
          {message.intent && INTENT_LABELS[message.intent] && (
            <span className="intent-tag">
              {INTENT_LABELS[message.intent]}
              {typeof message.confidence === 'number' && (
                <em>{Math.round(message.confidence * 100)}%</em>
              )}
            </span>
          )}
          {isShopkeeper && message.source === 'voice' && <span className="voice-tag">bol kar</span>}
          <time>{clock(message.at)}</time>
        </div>
        {message.choices && message.choices.length > 0 && (
          <Choices choices={message.choices} onSend={onSend} />
        )}
      </div>
    </div>
  );
}

export function Conversation({
  messages,
  busy,
  examples,
  onSend,
  speakOn,
  onToggleSpeak,
  voice,
  engineLabel,
}: ConversationProps) {
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy, voice.listening]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    onSend(text);
  };

  const handleMic = () => {
    if (voice.listening) voice.stop();
    else voice.start();
  };

  return (
    <section className="panel talk" aria-label="Dukaan se baat-cheet">
      <header className="talk-head">
        <div>
          <h2>Baat-cheet</h2>
          <p>Hinglish mein boliye — hisaab khud likha jayega.</p>
        </div>
        <div className={`listen-pill${voice.listening ? ' is-listening' : ''}`}>
          <span className="bars" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          {voice.listening ? 'Sun raha hoon' : 'Taiyaar hoon'}
        </div>
      </header>

      <div className="thread" aria-live="polite">
        {messages.map((message) => (
          <Message key={message.id} message={message} onSend={onSend} />
        ))}

        {messages.length <= 1 && !busy && (
          <div className="examples">
            <span className="examples-label">Aise boliye</span>
            <div className="example-chips">
              {examples.slice(0, 5).map((example) => (
                <button key={example} type="button" onClick={() => onSend(example)}>
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {busy && (
          <div className="msg from-saathi thinking">
            <div className="msg-avatar" aria-hidden="true">
              द
            </div>
            <div className="bubble">
              <span className="dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="sr-only">Soch raha hoon</span>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {voice.error && (
        <div className="mic-error" role="status">
          <span>{voice.error}</span>
          <button type="button" onClick={voice.clearError} aria-label="Band karein">
            ×
          </button>
        </div>
      )}

      <form className="composer" onSubmit={submit}>
        <button
          type="button"
          className={`mic${voice.listening ? ' is-recording' : ''}`}
          onClick={handleMic}
          disabled={busy}
          aria-label={voice.listening ? 'Sunna band karein' : 'Bol kar bhejein'}
          aria-pressed={voice.listening}
        >
          <span className="mic-ring" aria-hidden="true" />
          <MicIcon />
        </button>

        <div className={`composer-field${voice.listening ? ' is-live' : ''}`}>
          {voice.listening ? (
            <span className="live-text">{voice.interim || 'Boliye…'}</span>
          ) : (
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Jaise: Ramesh ko 2 kilo chawal udhaar diya"
              aria-label="Hinglish mein likhein"
              autoComplete="off"
              disabled={busy}
            />
          )}
          <span className="field-hint">{voice.listening ? 'Aawaz se' : 'Enter'}</span>
        </div>

        <button
          className="send"
          type="submit"
          disabled={!draft.trim() || busy || voice.listening}
          aria-label="Bhejein"
        >
          <SendIcon />
        </button>
      </form>

      <div className="talk-foot">
        <button
          type="button"
          className="toggle"
          onClick={onToggleSpeak}
          aria-pressed={speakOn}
        >
          {speakOn ? <SpeakerIcon /> : <SpeakerOffIcon />}
          {speakOn ? 'Aawaz jawab on' : 'Aawaz jawab off'}
        </button>
        <span className="engine-label">
          <span className="dot" aria-hidden="true" />
          {engineLabel}
        </span>
      </div>
    </section>
  );
}
