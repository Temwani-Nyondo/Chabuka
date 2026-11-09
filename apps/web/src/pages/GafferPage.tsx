import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { askGafferStream, transcribeVoiceNote } from '../lib/api';
import { useLiveConversation } from '../lib/liveVoice';
import { blobToDataUrl, recordingToWav } from '../lib/voice';
import { ChatComposer, ChatThread, GafferAvatar, GafferHeader, VoiceOrb, streamSink } from '../components/gaffer/gaffer';
import type { GafferMessage } from '../components/gaffer/gaffer';

const HISTORY_LIMIT = 10;

const toHistory = (messages: GafferMessage[]) =>
  messages.slice(-HISTORY_LIMIT).map((m) => ({
    role: m.from === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.text,
  }));

// Phone photos are megabytes; downscale to ~1024px JPEG before upload so
// vision turns stay fast and cheap. Resolves null when anything fails, and
// the caller falls back to the original file.
const PHOTO_MAX_DIM = 1024;

function downscalePhoto(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2d context.');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(null);
              return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          },
          'image/jpeg',
          0.85,
        );
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function friendlyError(err: unknown): string {
  const text = err instanceof Error ? err.message : '';
  if (/sign-in|signed in/i.test(text)) return 'Your session expired. Sign in again.';
  if (/too many|slow down/i.test(text)) return 'Give me a moment, then ask again.';
  return "Sorry, I couldn't get that done. Say that again?";
}

export default function GafferPage({ onClose }: { onClose?: () => void }) {
  const { session, user } = useAuth();
  const token = session?.access_token;
  const [messages, setMessages] = useState<GafferMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // The hands-free loop runs outside React's render, so it reads the latest
  // conversation and token through refs.
  const messagesRef = useRef<GafferMessage[]>([]);
  messagesRef.current = messages;
  const tokenRef = useRef<string | undefined>(token);
  tokenRef.current = token;

  const live = useLiveConversation({
    transcribe: (dataUrl) => transcribeVoiceNote(dataUrl, tokenRef.current ?? ''),
    respond: async (heard, handlers) => {
      const t = tokenRef.current;
      const history = toHistory(messagesRef.current);
      setMessages((prev) => [...prev, { from: 'user', text: heard }]);
      if (!t) return 'Your session expired. Sign in again.';
      const sink = streamSink(setMessages);
      try {
        const turn = await askGafferStream(heard, history, t, [], handlers.signal, {
          onDelta: (text) => {
            sink.onDelta(text);
            handlers.onDelta(text);
          },
          onRetract: () => {
            sink.onRetract();
            handlers.onRetract();
          },
        });
        sink.finish(turn.reply, turn.actionsTaken);
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
    },
    onScripted: (heard, say) =>
      setMessages((prev) => [
        ...prev,
        ...(heard ? [{ from: 'user' as const, text: heard }] : []),
        { from: 'gaffer' as const, text: say },
      ]),
    onError: (message) => setError(message),
  });

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  // Keep the conversation across navigation: one stored thread per user.
  useEffect(() => {
    if (!user) {
      setMessages([]);
      return;
    }
    try {
      const raw = localStorage.getItem(`gaffer:chat:${user.id}`);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const kept: GafferMessage[] = [];
      for (const item of parsed) {
        if (typeof item !== 'object' || item === null) continue;
        const row = item as { from?: unknown; text?: unknown; actionsTaken?: unknown };
        if ((row.from !== 'user' && row.from !== 'gaffer') || typeof row.text !== 'string') continue;
        const actions = Array.isArray(row.actionsTaken)
          ? row.actionsTaken.filter(
              (a): a is { name: string; ok: boolean; detail?: string } =>
                typeof a === 'object' &&
                a !== null &&
                typeof (a as { name?: unknown }).name === 'string' &&
                typeof (a as { ok?: unknown }).ok === 'boolean',
            )
          : undefined;
        kept.push({ from: row.from, text: row.text.slice(0, 4000), actionsTaken: actions });
      }
      setMessages(kept.slice(-50));
    } catch {
      // Corrupt cache: start fresh rather than crash the page.
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    try {
      localStorage.setItem(`gaffer:chat:${user.id}`, JSON.stringify(messages.slice(-50)));
    } catch {
      // Quota or private mode: the live thread still works, it just will not resume.
    }
  }, [messages, user?.id]);

  const send = async (raw: string, attached: string[] = photos) => {
    const message = raw.trim();
    if ((!message && attached.length === 0) || busy) return;
    if (!token) {
      setError('Not signed in.');
      return;
    }
    setError(null);
    setBusy(true);
    const history = toHistory(messages);
    setMessages((prev) => [...prev, { from: 'user', text: message || '(photo)' }]);
    setDraft('');
    setPhotos([]);
    const controller = new AbortController();
    abortRef.current = controller;
    const sink = streamSink(setMessages);
    try {
      const turn = await askGafferStream(
        message || 'What do you see in these photos?',
        history,
        token,
        attached,
        controller.signal,
        { onDelta: sink.onDelta, onRetract: sink.onRetract },
      );
      sink.finish(turn.reply, turn.actionsTaken);
    } catch (err) {
      // Nothing was answered: take the message back out of the thread and put
      // it in the composer so it can be sent again, not retyped. If Gaffer had
      // started writing, that partial reply goes too.
      sink.onRetract();
      setMessages((prev) => prev.slice(0, -1));
      setDraft(message);
      setPhotos(attached);
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Gaffer could not answer. Try again.');
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const attachPhotos = (files: FileList | null) => {
    if (!files) return;
    const readers = [...files].slice(0, 3 - photos.length).map(
      (file) =>
        new Promise<string | null>((resolve) => {
          if (!file.type.startsWith('image/')) {
            resolve(null);
            return;
          }
          const readOriginal = () => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          };
          void downscalePhoto(file).then((small) => {
            if (small) resolve(small);
            else readOriginal();
          });
        }),
    );
    void Promise.all(readers).then((results) => {
      const valid = results.filter((r): r is string => r !== null);
      setPhotos((prev) => [...prev, ...valid].slice(0, 3));
    });
  };

  // One-shot voice note: record, stop, and the words land in the message box.
  const toggleRecording = () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!token) {
      setError('Not signed in.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setError('Voice notes are not supported in this browser.');
      return;
    }
    setError(null);
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const recorder = new MediaRecorder(stream);
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          setRecording(false);
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          setBusy(true);
          recordingToWav(blob)
            .then((wav) => blobToDataUrl(wav))
            .then((dataUrl) => transcribeVoiceNote(dataUrl, token))
            .then((text) => setDraft(text))
            .catch((err: unknown) =>
              setError(err instanceof Error ? err.message : 'Transcription failed. Try again.'),
            )
            .finally(() => setBusy(false));
        };
        recorderRef.current = recorder;
        recorder.start();
        setRecording(true);
      })
      .catch(() => setError('Microphone access was denied.'));
  };

  const clearChat = () => {
    abortRef.current?.abort();
    if (live.active) live.stop();
    window.speechSynthesis?.cancel();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    setMessages([]);
    setError(null);
    try {
      if (user) window.localStorage.removeItem(`gaffer:chat:${user.id}`);
    } catch {
      // Private mode: nothing stored, nothing to clear.
    }
  };

  const status = live.active ? live.state : busy ? 'thinking' : 'ready';

  return (
    <div className={onClose ? 'gaffer-chat' : 'gaffer-page'}>
      <GafferHeader status={status} onClear={messages.length > 0 ? clearChat : undefined} onClose={onClose} />
      <ChatThread
        messages={messages}
        thinking={busy || live.state === 'thinking'}
        onStop={busy ? () => abortRef.current?.abort() : undefined}
        empty={
          <div className="gaffer-empty">
            <GafferAvatar size={56} />
            <strong>Gaffer</strong>
            <span>Type a message, or tap the sound-wave to talk.</span>
          </div>
        }
      />
      {error ? (
        <p className="error" style={{ padding: '0 16px' }}>
          {error}
        </p>
      ) : null}
      <VoiceOrb state={live.state} hearing={live.hearing} onEnd={live.stop} />
      <ChatComposer
        value={draft}
        onChange={setDraft}
        onSend={() => void send(draft)}
        busy={busy}
        placeholder="Ask Gaffer…"
        photos={photos}
        onAttach={attachPhotos}
        onRemovePhoto={(i) => setPhotos((prev) => prev.filter((_, k) => k !== i))}
        onToggleRecord={toggleRecording}
        recording={recording}
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
