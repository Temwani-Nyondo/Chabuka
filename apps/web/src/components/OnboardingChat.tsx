import { useRef, useState } from 'react';
import type { OnboardingProgress } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { askGafferStream, transcribeVoiceNote } from '../lib/api';
import { useLiveConversation } from '../lib/liveVoice';
import { ChatComposer, ChatThread, GafferHeader, VoiceOrb, streamSink } from './gaffer/gaffer';
import type { GafferMessage } from './gaffer/gaffer';

const INTRO: GafferMessage = {
  from: 'gaffer',
  text: "Hey, I'm Gaffer. Tell me about yourself, like your name, where you're based and what you play. Say it however it comes out.",
};

const HISTORY_LIMIT = 10;

const toHistory = (messages: GafferMessage[]) =>
  messages.slice(-HISTORY_LIMIT).map((m) => ({
    role: m.from === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.text,
  }));

function friendlyError(err: unknown): string {
  const text = err instanceof Error ? err.message : '';
  if (/sign-in|signed in/i.test(text)) return 'Your session expired. Sign in again.';
  if (/too many|slow down/i.test(text)) return 'Give me a moment, then tell me again.';
  return "Sorry, I couldn't catch that. Say it again?";
}

const ESSENTIALS: { key: keyof OnboardingProgress; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'area', label: 'Area' },
  { key: 'sports', label: 'Sports' },
];
const EXTRAS: { key: keyof OnboardingProgress; label: string }[] = [
  { key: 'age', label: 'Age' },
  { key: 'travel', label: 'Travel' },
  { key: 'availability', label: 'Free times' },
  { key: 'gameTypes', label: 'Game kinds' },
];

function Checklist({ progress }: { progress: OnboardingProgress | null }) {
  const item = (key: keyof OnboardingProgress, label: string, optional: boolean) => {
    const done = progress?.[key] === true;
    return (
      <li key={key} className={done ? 'check-item check-done' : optional ? 'check-item check-optional' : 'check-item'}>
        <span className="check-dot" aria-hidden="true" />
        {label}
        <span className="visually-hidden">{done ? ' saved' : optional ? ' optional, not added' : ' still needed'}</span>
      </li>
    );
  };
  return (
    <ul className="card-checklist" aria-label="Your player card">
      {ESSENTIALS.map((e) => item(e.key, e.label, false))}
      {EXTRAS.map((e) => item(e.key, e.label, true))}
    </ul>
  );
}

// First-time setup as a real conversation. The server runs a dedicated agent
// that only writes the player card; this screen shows the chat, a live
// checklist of what is saved, and "Go to Home" as soon as the essentials are
// in. It deliberately does NOT refresh the profile mid-chat: once the card is
// complete the app redirects away from /onboarding, which would cut off the
// optional follow-up.
export default function OnboardingChat({ onDone }: { onDone: () => Promise<void> | void }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const [messages, setMessages] = useState<GafferMessage[]>([INTRO]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [leaving, setLeaving] = useState(false);
  const messagesRef = useRef<GafferMessage[]>(messages);
  messagesRef.current = messages;
  const tokenRef = useRef<string | undefined>(token);
  tokenRef.current = token;

  const ask = async (
    text: string,
    handlers?: { onDelta: (t: string) => void; onRetract: () => void; signal?: AbortSignal },
  ): Promise<string> => {
    const t = tokenRef.current;
    if (!t) return 'Your session expired. Sign in again.';
    const history = toHistory(messagesRef.current);
    setMessages((prev) => [...prev, { from: 'user', text }]);
    const sink = streamSink(setMessages);
    try {
      const turn = await askGafferStream(text, history, t, [], handlers?.signal, {
        mode: 'onboarding',
        onDelta: (piece) => {
          sink.onDelta(piece);
          handlers?.onDelta(piece);
        },
        onRetract: () => {
          sink.onRetract();
          handlers?.onRetract();
        },
      });
      if (turn.progress) setProgress(turn.progress);
      sink.finish(turn.reply);
      return turn.reply;
    } catch (err) {
      // Talked over: keep what was written so far and let the loop move on.
      if (err instanceof DOMException && err.name === 'AbortError') {
        sink.abandon();
        return '';
      }
      const reply = friendlyError(err);
      sink.finish(reply);
      return reply;
    }
  };

  const live = useLiveConversation({
    transcribe: (dataUrl) => transcribeVoiceNote(dataUrl, tokenRef.current ?? ''),
    respond: ask,
    onScripted: (heard, say) =>
      setMessages((prev) => [
        ...prev,
        ...(heard ? [{ from: 'user' as const, text: heard }] : []),
        { from: 'gaffer' as const, text: say },
      ]),
    onError: (message) => setError(message),
  });

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setError(null);
    setBusy(true);
    setDraft('');
    try {
      await ask(text);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setLeaving(true);
    if (live.active) live.stop();
    try {
      await onDone();
    } finally {
      setLeaving(false);
    }
  };

  const status = live.active ? live.state : busy ? 'thinking' : 'ready';

  return (
    <div className="onboarding-chat gaffer-chat">
      <GafferHeader status={status} />
      <Checklist progress={progress} />
      <ChatThread messages={messages} thinking={busy || live.state === 'thinking'} />
      {error ? (
        <p className="error" style={{ padding: '0 16px' }}>
          {error}
        </p>
      ) : null}
      {progress?.essentialsComplete ? (
        <div className="onboarding-done">
          <span>Your card is ready. You can keep going or head in.</span>
          <button className="btn btn-primary" type="button" disabled={leaving} onClick={() => void finish()}>
            {leaving ? 'One moment…' : 'Go to Home'}
          </button>
        </div>
      ) : null}
      <VoiceOrb state={live.state} hearing={live.hearing} onEnd={live.stop} />
      <ChatComposer
        value={draft}
        onChange={setDraft}
        onSend={() => void send()}
        busy={busy}
        placeholder="Tell Gaffer about you…"
        live={{
          active: live.active,
          onToggle: () => {
            if (live.active) live.stop();
            else void live.start();
          },
        }}
      />
    </div>
  );
}
