import { useState } from 'react';
import type { FormEvent } from 'react';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../auth/AuthContext';
import { askGaffer } from '../lib/api';

interface ChatMessage {
  from: 'user' | 'gaffer';
  text: string;
  actionsTaken?: { name: string; ok: boolean }[];
}

const HISTORY_LIMIT = 10;

// Tappable starters so every turn leaves something to tap, per the UI
// vision: the Gaffer suggests and shows what it did, never dumps paragraphs.
const STARTERS = [
  'Find me a game this weekend',
  'Book us a court for Thursday',
  'Explain the 5v5 basketball rules',
  'Recap my week',
];

export default function GafferPage() {
  const { session } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    const token = session?.access_token;
    if (!token) {
      setError('Not signed in.');
      return;
    }
    setError(null);
    setBusy(true);
    const history = messages
      .filter((m) => m.from === 'user')
      .slice(-HISTORY_LIMIT)
      .map((m) => ({ role: 'user' as const, content: m.text }));
    setMessages((prev) => [...prev, { from: 'user', text: message }]);
    setDraft('');
    try {
      const turn = await askGaffer(message, history, token);
      setMessages((prev) => [
        ...prev,
        { from: 'gaffer', text: turn.reply, actionsTaken: turn.actionsTaken },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The Gaffer could not answer. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  return (
    <div className="page floodlight">
      <h1>Ask the Gaffer</h1>
      <p className="muted">Game plans, rules, briefs, bookings — the Gaffer sorts it.</p>
      {messages.length === 0 ? (
        <EmptyState title="No messages yet" hint="Pick one to get going." />
      ) : null}
      {messages.length === 0 ? (
        <div className="chips">
          {STARTERS.map((s) => (
            <button
              key={s}
              className="chip"
              type="button"
              disabled={busy}
              onClick={() => {
                void send(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
      {messages.map((m, i) =>
        m.from === 'user' ? (
          <p className="muted" key={i}>
            You: {m.text}
          </p>
        ) : (
          <div className="card" key={i}>
            <div className="row">
              <strong>Gaffer</strong>
              {m.actionsTaken && m.actionsTaken.length > 0 ? (
                <span className="tag">
                  {m.actionsTaken.filter((a) => a.ok).length}/{m.actionsTaken.length} sorted
                </span>
              ) : null}
            </div>
            <p>{m.text}</p>
            {m.actionsTaken && m.actionsTaken.length > 0 ? (
              <details className="trace">
                <summary>What the Gaffer did</summary>
                <p className="muted">
                  {m.actionsTaken.map((a) => `${a.name} ${a.ok ? '✓' : '✗'}`).join(' · ')}
                </p>
              </details>
            ) : null}
          </div>
        ),
      )}
      {error ? <p className="error">{error}</p> : null}
      <form onSubmit={submit}>
        <div className="field">
          <input
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask the Gaffer…"
            maxLength={2000}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy || draft.trim() === ''}>
          {busy ? 'Gaffer is sorting…' : 'Ask'}
        </button>
      </form>
    </div>
  );
}
