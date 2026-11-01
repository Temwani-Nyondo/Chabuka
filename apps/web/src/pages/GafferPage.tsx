import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../auth/AuthContext';
import { askGaffer, transcribeVoiceNote } from '../lib/api';

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

// Meta's transcribe endpoint only takes WAV (mono 16-bit PCM). The mic
// usually records webm/opus, so decode it here and re-encode 16 kHz mono
// WAV — no server ffmpeg needed.
const WAV_SAMPLE_RATE = 16000;
const MAX_VOICE_SECONDS = 180;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

async function recordingToWav(blob: Blob): Promise<Blob> {
  const source = await blob.arrayBuffer();
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error('Voice notes are not supported in this browser.');
  const ctx = new Ctor();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(source);
  } finally {
    void ctx.close().catch(() => undefined);
  }
  if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) {
    throw new Error('Could not read the recording. Try again.');
  }
  if (decoded.duration > MAX_VOICE_SECONDS) {
    throw new Error('Voice note is too long. Keep it under 3 minutes.');
  }
  const offline = new OfflineAudioContext(
    1,
    Math.max(1, Math.floor(decoded.duration * WAV_SAMPLE_RATE)),
    WAV_SAMPLE_RATE,
  );
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), WAV_SAMPLE_RATE);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' && reader.result
        ? resolve(reader.result)
        : reject(new Error('Could not read the recording. Try again.'));
    reader.onerror = () => reject(new Error('Could not read the recording. Try again.'));
    reader.readAsDataURL(blob);
  });
}

// Live voice chat runs fully in the browser: the mic stays open, an
// energy-based voice activity detector ends your turn on ~1.4s of silence,
// and while the Gaffer speaks the same detector lets you talk over him
// (barge-in). Transcription and answers reuse the normal voice-note and
// helper endpoints; speech output uses the device's own voices.
const VAD_SPEECH_RMS = 0.025;
const VAD_SILENCE_MS = 1400;
const VAD_MIN_SPEECH_MS = 500;
const VAD_MAX_UTTERANCE_MS = 45000;
// Barge-in calibrates itself: the first moments of his own speech measure
// how loud the speaker output sounds through this mic, then only clearly
// louder, sustained sound counts as the user talking back. Falls back to a
// fixed floor (headphones: near-silence) when nothing leaks through.
const VAD_BARGE_FLOOR = 0.035;
const VAD_BARGE_CEILING = 0.12;
const VAD_BARGE_MS = 400;
const VAD_BARGE_GRACE_MS = 900;

interface MicMeter {
  rms: () => number;
  stop: () => void;
}

function micLevel(stream: MediaStream): MicMeter {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error('Voice notes are not supported in this browser.');
  const ctx = new Ctor();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  return {
    rms() {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i += 1) {
        const v = ((buf[i] ?? 128) - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / buf.length);
    },
    stop() {
      void ctx.close().catch(() => undefined);
    },
  };
}

function captureUtterance(
  stream: MediaStream,
  onManualStop: (stop: () => void) => void,
  opts?: { minSpeechMs?: number; silenceMs?: number },
): Promise<Blob> {
  const minSpeechMs = opts?.minSpeechMs ?? VAD_MIN_SPEECH_MS;
  const silenceMs = opts?.silenceMs ?? VAD_SILENCE_MS;
  return new Promise((resolve, reject) => {
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      reject(new Error('Voice notes are not supported in this browser.'));
      return;
    }
    const chunks: BlobPart[] = [];
    const meter = micLevel(stream);
    let done = false;
    let heardAt = 0;
    const startedAt = Date.now();
    const finish = () => {
      if (done) return;
      done = true;
      window.clearInterval(timer);
      meter.stop();
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // Already stopped; onstop below still resolves.
        }
      }
    };
    onManualStop(finish);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      finish();
      resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    };
    recorder.onerror = () => {
      finish();
      reject(new Error('Recording failed. Try again.'));
    };
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (meter.rms() > VAD_SPEECH_RMS) heardAt = now;
      const spoken = heardAt > 0;
      const silentFor = spoken ? now - heardAt : 0;
      if (spoken && now - startedAt > minSpeechMs && silentFor > silenceMs) finish();
      else if (now - startedAt > VAD_MAX_UTTERANCE_MS) finish();
    }, 100);
    recorder.start();
  });
}

function speakText(text: string, stream: MediaStream | null): Promise<'done' | 'barged'> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      resolve('done');
      return;
    }
    let settled = false;
    let bargeTimer: number | undefined;
    let meter: MicMeter | null = null;
    const finish = (outcome: 'done' | 'barged') => {
      if (settled) return;
      settled = true;
      if (bargeTimer !== undefined) window.clearInterval(bargeTimer);
      meter?.stop();
      resolve(outcome);
    };
    // Barge-in: during the grace window measure how loud his own voice
    // sounds through this mic, then cut him off only for clearly louder,
    // sustained sound — a real interruption, not speaker leakage.
    if (stream) {
      try {
        meter = micLevel(stream);
        const active = meter;
        const startedAt = Date.now();
        let loudFor = 0;
        let graceSum = 0;
        let graceSamples = 0;
        let threshold = VAD_BARGE_FLOOR;
        bargeTimer = window.setInterval(() => {
          const level = active.rms();
          if (Date.now() - startedAt < VAD_BARGE_GRACE_MS) {
            graceSum += level;
            graceSamples += 1;
            return;
          }
          if (graceSamples > 0) {
            const baseline = graceSum / graceSamples;
            threshold = Math.min(VAD_BARGE_CEILING, Math.max(VAD_BARGE_FLOOR, baseline * 3));
            graceSamples = 0;
          }
          loudFor = level > threshold ? loudFor + 100 : 0;
          if (loudFor > VAD_BARGE_MS) {
            synth.cancel();
            finish('barged');
          }
        }, 100);
      } catch {
        meter = null;
      }
    }
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text.slice(0, 600));
    // Prefer a natural/online voice over the flat default; fall back to any
    // English voice. Slightly slower and warmer than the defaults.
    const voices = synth.getVoices();
    const preferred =
      voices.find((v) => v.lang.toLowerCase().startsWith('en') && /natural|online|google/i.test(v.name)) ??
      voices.find((v) => v.lang.toLowerCase().startsWith('en')) ??
      null;
    if (preferred) utter.voice = preferred;
    utter.rate = 0.95;
    utter.pitch = 1.1;
    utter.onend = () => finish('done');
    utter.onerror = () => finish('done');
    synth.speak(utter);
  });
}

export default function GafferPage() {
  const { session } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [convo, setConvo] = useState<'off' | 'listening' | 'thinking' | 'speaking'>('off');
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const convoActiveRef = useRef(false);
  const convoStopCaptureRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      convoActiveRef.current = false;
      convoStopCaptureRef.current?.();
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const send = async (raw: string, attached: string[] = photos) => {
    const message = raw.trim();
    if ((!message && attached.length === 0) || busy) return;
    const token = session?.access_token;
    if (!token) {
      setError('Not signed in.');
      return;
    }
    setError(null);
    setBusy(true);
    const history = messages
      .slice(-HISTORY_LIMIT)
      .map((m) =>
        m.from === 'user'
          ? { role: 'user' as const, content: m.text }
          : { role: 'assistant' as const, content: m.text },
      );
    setMessages((prev) => [
      ...prev,
      { from: 'user', text: message || '(photo)' },
    ]);
    setDraft('');
    setPhotos([]);
    try {
      const turn = await askGaffer(message || 'What do you see in these photos?', history, token, attached);
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

  const attachPhotos = (files: FileList | null) => {
    if (!files) return;
    const readers = [...files].slice(0, 3 - photos.length).map(
      (file) =>
        new Promise<string | null>((resolve) => {
          if (!file.type.startsWith('image/')) {
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        }),
    );
    void Promise.all(readers).then((results) => {
      const valid = results.filter((r): r is string => r !== null);
      setPhotos((prev) => [...prev, ...valid].slice(0, 3));
    });
  };

  const toggleRecording = () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    const token = session?.access_token;
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  const stopConvo = () => {
    convoActiveRef.current = false;
    window.speechSynthesis?.cancel();
    convoStopCaptureRef.current?.();
    setConvo('off');
  };

  const startConvo = () => {
    const token = session?.access_token;
    if (!token) {
      setError('Not signed in.');
      return;
    }
    if (typeof MediaRecorder === 'undefined' || !window.speechSynthesis) {
      setError('Live chat is not supported in this browser. Try Chrome or Edge.');
      return;
    }
    if (recording) recorderRef.current?.stop();
    setError(null);
    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch {
        setError('Microphone access was denied.');
        return;
      }
      convoActiveRef.current = true;
      const transcript = messages
        .slice(-HISTORY_LIMIT)
        .map((m) =>
          m.from === 'user'
            ? { role: 'user' as const, content: m.text }
            : { role: 'assistant' as const, content: m.text },
        );
      let turns = 0;
      // Set when the user talks over the Gaffer: the interruption itself is
      // mid-sentence, so the next capture listens with a shorter fuse.
      let interrupted = false;
      try {
        while (convoActiveRef.current && turns < 30) {
          turns += 1;
          setConvo('listening');
          const blob = await captureUtterance(
            stream,
            (stop) => {
              convoStopCaptureRef.current = stop;
            },
            interrupted ? { minSpeechMs: 200, silenceMs: 800 } : undefined,
          ).catch(() => null);
          interrupted = false;
          convoStopCaptureRef.current = null;
          if (!convoActiveRef.current || !blob) break;
          setConvo('thinking');
          let heard = '';
          let heardError: string | null = null;
          try {
            heard = (await transcribeVoiceNote(await blobToDataUrl(await recordingToWav(blob)), token)).trim();
          } catch (err) {
            heard = '';
            heardError = err instanceof Error ? err.message : null;
          }
          if (!convoActiveRef.current) break;
          if (!heard) {
            // A server problem (keys missing, API down) is not a hearing
            // problem: say so instead of blaming the user's voice.
            const setupProblem =
              heardError && /not set up|transcription key|model key|could not reach/i.test(heardError);
            await speakText(
              setupProblem && heardError ? heardError : "Sorry, I didn't catch that. Say that again?",
              stream,
            );
            continue;
          }
          setMessages((prev) => [...prev, { from: 'user', text: heard }]);
          transcript.push({ role: 'user', content: heard });
          let reply = 'The Gaffer could not answer. Try again.';
          let actionsTaken: { name: string; ok: boolean }[] | undefined;
          try {
            const turn = await askGaffer(heard, transcript.slice(-HISTORY_LIMIT), token, []);
            reply = turn.reply;
            actionsTaken = turn.actionsTaken;
          } catch (err) {
            reply = err instanceof Error ? err.message : reply;
          }
          if (!convoActiveRef.current) break;
          setMessages((prev) => [...prev, { from: 'gaffer', text: reply, actionsTaken }]);
          transcript.push({ role: 'assistant', content: reply });
          setConvo('speaking');
          interrupted = (await speakText(reply, stream)) === 'barged';
        }
      } finally {
        convoActiveRef.current = false;
        convoStopCaptureRef.current = null;
        stream.getTracks().forEach((t) => t.stop());
        window.speechSynthesis?.cancel();
        setConvo('off');
      }
    })();
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
              {m.actionsTaken && m.actionsTaken.some((a) => !a.ok) ? (
                <span className="tag">
                  {m.actionsTaken.filter((a) => a.ok).length}/{m.actionsTaken.length} worked — see
                  details
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
      {convo !== 'off' ? (
        <p className="muted" role="status">
          {convo === 'listening'
            ? 'Listening… speak, then pause and the Gaffer answers.'
            : convo === 'thinking'
              ? 'Gaffer is thinking…'
              : 'Gaffer speaking… talk to interrupt.'}
        </p>
      ) : null}
      <form onSubmit={submit}>
        {photos.length > 0 ? (
          <p className="muted">
            {photos.length} photo{photos.length > 1 ? 's' : ''} attached{' '}
            <button className="btn btn-ghost" type="button" onClick={() => setPhotos([])}>
              Clear
            </button>
          </p>
        ) : null}
        <div className="composer">
          <input
            className="composer-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask the Gaffer…"
            maxLength={2000}
            aria-label="Message the Gaffer"
          />
          <div className="composer-row">
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
                  attachPhotos(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            <span className="composer-spacer" />
            <button
              className={recording ? 'iconbtn iconbtn-recording' : 'iconbtn'}
              type="button"
              disabled={busy || convo !== 'off'}
              onClick={toggleRecording}
              aria-label={recording ? 'Stop recording' : 'Record a voice note'}
              title={recording ? 'Stop recording' : 'Record a voice note'}
            >
              {recording ? (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="6" y="1" width="4" height="8" rx="2" fill="currentColor" />
                  <path d="M3 7a5 5 0 0 0 10 0h-1.5a3.5 3.5 0 0 1-7 0H3z" fill="currentColor" />
                  <rect x="7.25" y="12" width="1.5" height="3" fill="currentColor" />
                </svg>
              )}
            </button>
            <button
              className={convo !== 'off' ? 'iconbtn iconbtn-recording' : 'iconbtn'}
              type="button"
              disabled={busy || recording}
              onClick={() => {
                if (convo !== 'off') stopConvo();
                else startConvo();
              }}
              aria-label={convo !== 'off' ? 'End live chat' : 'Start live voice chat'}
              title={convo !== 'off' ? 'End live chat' : 'Live voice chat'}
            >
              {convo !== 'off' ? (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H7l-3.5 3v-3H3.5A1.5 1.5 0 0 1 2 9.5v-6z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <circle cx="5.5" cy="7" r="1" fill="currentColor" />
                  <circle cx="8" cy="7" r="1" fill="currentColor" />
                  <circle cx="10.5" cy="7" r="1" fill="currentColor" />
                </svg>
              )}
            </button>
            <button
              className="iconbtn iconbtn-send"
              type="submit"
              disabled={busy || convo !== 'off' || (draft.trim() === '' && photos.length === 0)}
              aria-label={busy ? 'Gaffer is sorting' : 'Send message'}
              title="Send"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path d="M9 2.5 15.5 9 9 15.5 7.6 14.1 11.7 10H2.5V8h9.2L7.6 3.9 9 2.5z" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
