import { useEffect, useRef } from 'react';
import type { Dispatch, FormEvent, KeyboardEvent, ReactNode, SetStateAction } from 'react';
import { Link } from 'react-router-dom';
import type { LiveState } from '../../lib/liveVoice';

// Shared chat pieces for Gaffer: the main panel and the onboarding chat use
// exactly the same avatar, bubbles, composer and voice indicator.

export interface GafferStep {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface GafferMessage {
  from: 'user' | 'gaffer';
  text: string;
  actionsTaken?: GafferStep[];
  // A reply still being written: it grows as text arrives from the server.
  streaming?: boolean;
}

/**
 * Feeds a streamed reply into the message list: the first text opens a Gaffer
 * bubble, later text extends it, `retract` removes it (the round became actions),
 * `finish` replaces it with the final turn, `abandon` keeps whatever was written.
 */
export function streamSink(setMessages: Dispatch<SetStateAction<GafferMessage[]>>) {
  let open = false;
  return {
    onDelta(text: string) {
      const first = !open;
      open = true;
      setMessages((prev) => {
        if (first) return [...prev, { from: 'gaffer', text, streaming: true }];
        const last = prev[prev.length - 1];
        if (!last?.streaming) return prev;
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      });
    },
    onRetract() {
      if (!open) return;
      open = false;
      setMessages((prev) => (prev[prev.length - 1]?.streaming ? prev.slice(0, -1) : prev));
    },
    finish(text: string, actionsTaken?: GafferStep[]) {
      const had = open;
      open = false;
      const final: GafferMessage = { from: 'gaffer', text, ...(actionsTaken ? { actionsTaken } : {}) };
      setMessages((prev) =>
        had && prev[prev.length - 1]?.streaming ? [...prev.slice(0, -1), final] : [...prev, final],
      );
    },
    abandon() {
      const had = open;
      open = false;
      if (!had) return;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        return last?.streaming ? [...prev.slice(0, -1), { ...last, streaming: false }] : prev;
      });
    },
  };
}

// What Gaffer did, in the player's words. Only actions that change something
// are listed; lookups stay out of sight.
const STEP_LABELS: Record<string, string> = {
  create_match: 'Created game',
  join_match: 'Joined game',
  withdraw_match: 'Left game',
  request_booking: 'Requested venue booking',
  cancel_booking: 'Cancelled booking',
  create_team: 'Created team',
  post_challenge: 'Posted challenge',
  accept_challenge: 'Accepted challenge',
  decline_challenge: 'Declined challenge',
  propose_time: 'Proposed a time',
  create_poll: 'Started poll',
  answer_poll: 'Answered poll',
  post_result: 'Posted result',
  report_score: 'Reported score',
  post_announcement: 'Posted announcement',
  join_circle: 'Joined circle',
  leave_circle: 'Left circle',
  create_circle: 'Created circle',
  update_profile: 'Updated profile',
  set_sports: 'Updated sports',
  set_availability: 'Updated availability',
  set_position: 'Updated position',
  set_game_types: 'Updated game types',
  add_place: 'Added place',
  remove_place: 'Removed place',
  save_memory: 'Remembered that',
  forget_memory: 'Forgot that',
};

function stepLabel(name: string): string | null {
  const known = STEP_LABELS[name];
  if (known) return known;
  if (/^(get_|search_)/.test(name) || name === 'venue_slots' || name === 'poll_status') return null;
  const words = name.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function stepLink(detail: string | undefined): { href: string; label: string } | null {
  if (!detail) return null;
  if (detail.startsWith('match:')) {
    return { href: `/explore?highlight=${encodeURIComponent(detail.slice('match:'.length))}`, label: 'View game' };
  }
  if (detail.startsWith('booking:')) return { href: '/venues/dashboard', label: 'Track booking' };
  return null;
}

export function GafferAvatar({ size = 32 }: { size?: number }) {
  return (
    <span
      className="gaffer-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      aria-hidden="true"
    >
      G
    </span>
  );
}

export function TypingDots() {
  return (
    <span className="typing" role="status" aria-label="Gaffer is thinking">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </span>
  );
}

const STATUS_TEXT: Record<'ready' | 'thinking' | LiveState, string> = {
  ready: 'Online',
  thinking: 'Thinking…',
  off: 'Online',
  listening: 'Listening…',
  speaking: 'Speaking…',
};

export function GafferHeader({
  status,
  onClear,
  onClose,
}: {
  status: 'ready' | 'thinking' | LiveState;
  onClear?: () => void;
  onClose?: () => void;
}) {
  return (
    <header className="gaffer-header">
      <GafferAvatar size={40} />
      <div className="gaffer-header-text">
        <strong>Gaffer</strong>
        <span className={status === 'ready' || status === 'off' ? 'gaffer-status' : 'gaffer-status gaffer-status-live'}>
          {STATUS_TEXT[status]}
        </span>
      </div>
      <div className="gaffer-header-actions">
        {onClear ? (
          <button className="btn btn-ghost gaffer-header-btn" type="button" onClick={onClear}>
            Clear
          </button>
        ) : null}
        {onClose ? (
          <button className="gaffer-close" type="button" onClick={onClose} aria-label="Close Gaffer">
            &times;
          </button>
        ) : null}
      </div>
    </header>
  );
}

function Bubble({ message }: { message: GafferMessage }) {
  if (message.from === 'user') {
    return (
      <div className="msg-row msg-row-user">
        <p className="bubble bubble-user">{message.text}</p>
      </div>
    );
  }
  const steps = (message.actionsTaken ?? []).flatMap((a) => {
    const label = stepLabel(a.name);
    return label ? [{ a, label }] : [];
  });
  return (
    <div className="msg-row">
      <GafferAvatar size={28} />
      <div className="msg-col">
        <p className="bubble bubble-gaffer">
          {message.text}
        </p>
        {steps.length > 0 ? (
          <div className="step-chips">
            {steps.map(({ a, label }, i) => {
              const link = stepLink(a.detail);
              return (
                <span key={i} className={a.ok ? 'step-chip step-ok' : 'step-chip step-bad'}>
                  {a.ok ? label : `Could not complete: ${label.toLowerCase()}`}
                  {link ? <Link to={link.href}>{link.label}</Link> : null}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The scrolling conversation. Keeps the newest message in view. */
export function ChatThread({
  messages,
  thinking,
  onStop,
  empty,
}: {
  messages: GafferMessage[];
  thinking: boolean;
  onStop?: () => void;
  empty?: ReactNode;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const last = messages[messages.length - 1];
  const writing = last?.streaming === true;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: writing ? 'auto' : 'smooth', block: 'end' });
  }, [messages.length, thinking, writing, last?.text.length]);
  return (
    <div className="chat-scroll">
      <div
        className="chat-thread"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation with Gaffer"
      >
        {messages.length === 0 && !thinking ? empty : null}
        {messages.map((m, i) => (
          <Bubble key={i} message={m} />
        ))}
        {thinking && !writing ? (
          <div className="msg-row">
            <GafferAvatar size={28} />
            <p className="bubble bubble-gaffer">
              <TypingDots />
            </p>
            {onStop ? (
              <button className="btn btn-ghost" type="button" onClick={onStop}>
                Stop
              </button>
            ) : null}
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/** Shown while a hands-free conversation is running. */
export function VoiceOrb({ state, hearing, onEnd }: { state: LiveState; hearing: string; onEnd: () => void }) {
  if (state === 'off') return null;
  const text =
    state === 'listening'
      ? hearing
        ? hearing
        : 'Listening. Speak, then pause.'
      : state === 'thinking'
        ? 'Thinking…'
        : 'Talk to interrupt.';
  return (
    <div className={`voice-orb voice-orb-${state}`} role="status" aria-live="polite">
      <span className="voice-bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="voice-orb-text">{text}</span>
      <button className="btn btn-ghost" type="button" onClick={onEnd}>
        End
      </button>
    </div>
  );
}

const WaveIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
    <rect x="2" y="8" width="2" height="4" rx="1" fill="currentColor" />
    <rect x="6" y="5" width="2" height="10" rx="1" fill="currentColor" />
    <rect x="10" y="2.5" width="2" height="15" rx="1" fill="currentColor" />
    <rect x="14" y="6" width="2" height="8" rx="1" fill="currentColor" />
    <rect x="18" y="8.5" width="1.5" height="3" rx="0.75" fill="currentColor" />
  </svg>
);

const StopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" />
  </svg>
);

const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="6" y="1" width="4" height="8" rx="2" fill="currentColor" />
    <path d="M3 7a5 5 0 0 0 10 0h-1.5a3.5 3.5 0 0 1-7 0H3z" fill="currentColor" />
    <rect x="7.25" y="12" width="1.5" height="3" fill="currentColor" />
  </svg>
);

/** Message box with attach, voice note, live voice and send. Optional parts appear only if wired. */
export function ChatComposer({
  value,
  onChange,
  onSend,
  busy,
  placeholder,
  photos,
  onAttach,
  onRemovePhoto,
  onToggleRecord,
  recording,
  live,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  placeholder: string;
  photos?: string[];
  onAttach?: (files: FileList | null) => void;
  onRemovePhoto?: (index: number) => void;
  onToggleRecord?: () => void;
  recording?: boolean;
  live?: { active: boolean; onToggle: () => void };
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);
  const liveActive = live?.active ?? false;
  const hasPhotos = (photos?.length ?? 0) > 0;
  const canSend = !busy && !liveActive && (value.trim() !== '' || hasPhotos);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSend) onSend();
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };
  return (
    <form className="chat-composer" onSubmit={submit}>
      {hasPhotos ? (
        <div className="photo-strip">
          {photos?.map((src, i) => (
            <div className="photo-thumb" key={i}>
              <img src={src} alt={`Attached photo ${i + 1}`} />
              <button
                type="button"
                className="photo-remove"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => onRemovePhoto?.(i)}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="composer">
        <textarea
          ref={inputRef}
          className="composer-input"
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
          maxLength={2000}
          aria-label="Message Gaffer"
          autoFocus={autoFocus}
          disabled={liveActive}
        />
        <div className="composer-row">
          {onAttach ? (
            <label className="iconbtn" aria-label="Attach photos" title="Attach photos">
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <rect x="9" y="4" width="2" height="12" rx="1" fill="currentColor" />
                <rect x="4" y="9" width="12" height="2" rx="1" fill="currentColor" />
              </svg>
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  onAttach(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          ) : null}
          <span className="composer-spacer" />
          {onToggleRecord ? (
            <button
              className={recording ? 'iconbtn iconbtn-recording' : 'iconbtn'}
              type="button"
              disabled={(busy && !recording) || liveActive}
              onClick={onToggleRecord}
              aria-label={recording ? 'Stop recording' : 'Record a voice note'}
              title={recording ? 'Stop recording' : 'Record a voice note'}
            >
              {recording ? <StopIcon /> : <MicIcon />}
            </button>
          ) : null}
          {live ? (
            <button
              className={liveActive ? 'iconbtn iconbtn-recording' : 'iconbtn'}
              type="button"
              disabled={(busy && !liveActive) || recording}
              onClick={live.onToggle}
              aria-label={liveActive ? 'End live voice' : 'Start live voice'}
              title={liveActive ? 'End live voice' : 'Live voice'}
            >
              {liveActive ? <StopIcon /> : <WaveIcon />}
            </button>
          ) : null}
          <button
            className="iconbtn iconbtn-send"
            type="submit"
            disabled={!canSend}
            aria-label={busy ? 'Gaffer is replying' : 'Send message'}
            title="Send"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M9 2.5 15.5 9 9 15.5 7.6 14.1 11.7 10H2.5V8h9.2L7.6 3.9 9 2.5z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    </form>
  );
}
