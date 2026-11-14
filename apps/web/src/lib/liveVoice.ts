import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyEnder, endpointDelay, speechSegments, splitSentences } from '@chabuka/shared';
import type { SpeechSegment } from '@chabuka/shared';
import { blobToDataUrl, recordingToWav } from './voice';

// Hands-free conversation, fully in the browser. The mic stays open and a voice
// activity detector decides when your turn is over. It is not a fixed pause: the
// quiet it waits for depends on what you just said (a full answer ends quickly, a
// sentence that trails off with "and" or a comma gets longer), and its sensitivity
// follows the room's background noise. While Gaffer speaks, the same detector lets
// you talk over him (barge-in). Speech recognition runs alongside, giving both a
// live display and the words that steer the pause; the server transcript decides
// what he answers. Speech output uses the device's own voices and starts on the
// first finished sentence of his reply, while the rest is still being written.
const VAD_MIN_RMS = 0.025;
const VAD_MAX_RMS = 0.09;
const VAD_NOISE_MULTIPLE = 2.5;
const VAD_CALIBRATE_MS = 400;
// Once you are talking, quieter sound still counts as talking, so soft word endings
// do not start the silence clock.
const VAD_KEEP_RATIO = 0.7;
const VAD_MIN_SPEECH_MS = 500;
const VAD_MAX_UTTERANCE_MS = 45000;
// Barge-in calibrates itself: the first moments of his own speech measure how
// loud the speaker sounds through this mic, then only clearly louder, sustained
// sound counts as the player talking back.
const VAD_BARGE_FLOOR = 0.035;
const VAD_BARGE_CEILING = 0.12;
const VAD_BARGE_MS = 400;
const VAD_BARGE_GRACE_MS = 900;

// Ending a conversation: silence for a while gets one check-in, then a sign-off.
const IDLE_FIRST_MS = 25_000;
const IDLE_SECOND_MS = 15_000;

const FAREWELLS_HARD = ['Catch you later.', 'Speak soon.', 'See you out there.', 'Take care.'];
const FAREWELLS_SOFT = ["All good. I'm here when you need me.", 'Sound. Tap the sound-wave if you need me.', 'No problem. Shout if you need anything.'];
const CHECK_IN = 'Still there?';
const IDLE_SIGN_OFF = "I'll leave it there. Tap the sound-wave whenever you want me back.";

const pick = (options: string[]) => options[Math.floor(Math.random() * options.length)] ?? options[0] ?? '';

const BASE_VOICE = { pitch: 1.1, rate: 0.95 };

interface InterimRecognizer {
  interimResults: boolean;
  continuous: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function startInterimListen(onText: (text: string) => void): (() => void) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => InterimRecognizer;
    webkitSpeechRecognition?: new () => InterimRecognizer;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  try {
    const recog = new Ctor();
    recog.interimResults = true;
    recog.continuous = true;
    recog.lang = navigator.language || 'en-US';
    recog.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i += 1) {
        text += (e.results[i]?.[0]?.transcript ?? '') + ' ';
      }
      onText(text.trim());
    };
    recog.onerror = () => undefined;
    recog.start();
    return () => {
      try {
        recog.stop();
      } catch {
        // Already stopped; the capture governs the turn, not this display.
      }
    };
  } catch {
    return null;
  }
}

interface MicMeter {
  rms: () => number;
  stop: () => void;
}

function micLevel(stream: MediaStream): MicMeter {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error('Voice is not supported in this browser.');
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

interface Capture {
  blob: Blob;
  /** True when nothing was said before the idle limit. */
  idle: boolean;
}

function captureUtterance(
  stream: MediaStream,
  onManualStop: (stop: () => void) => void,
  opts: {
    getLiveText: () => string;
    idleMs: number;
    /** Overrides the smart pause, used right after an interruption. */
    fixedSilenceMs?: number;
    minSpeechMs?: number;
  },
): Promise<Capture> {
  const minSpeechMs = opts.minSpeechMs ?? VAD_MIN_SPEECH_MS;
  return new Promise((resolve, reject) => {
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      reject(new Error('Voice is not supported in this browser.'));
      return;
    }
    const chunks: BlobPart[] = [];
    const meter = micLevel(stream);
    let done = false;
    let idle = false;
    let heardAt = 0;
    let threshold = VAD_MIN_RMS;
    let calibSum = 0;
    let calibSamples = 0;
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
      resolve({ blob: new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), idle });
    };
    recorder.onerror = () => {
      finish();
      reject(new Error('Recording failed. Try again.'));
    };
    const timer = window.setInterval(() => {
      const now = Date.now();
      const level = meter.rms();
      // Learn the room: the first moments, before anyone has spoken, set the floor.
      if (heardAt === 0 && now - startedAt < VAD_CALIBRATE_MS) {
        calibSum += level;
        calibSamples += 1;
        if (calibSamples >= 3) {
          threshold = Math.min(VAD_MAX_RMS, Math.max(VAD_MIN_RMS, (calibSum / calibSamples) * VAD_NOISE_MULTIPLE));
        }
        return;
      }
      const limit = heardAt > 0 ? threshold * VAD_KEEP_RATIO : threshold;
      if (level > limit) heardAt = now;
      if (heardAt === 0) {
        if (now - startedAt > opts.idleMs) {
          idle = true;
          finish();
        }
        return;
      }
      const silentFor = now - heardAt;
      const wait = opts.fixedSilenceMs ?? endpointDelay(opts.getLiveText());
      if (now - startedAt > minSpeechMs && silentFor > wait) finish();
      else if (now - startedAt > VAD_MAX_UTTERANCE_MS) finish();
    }, 100);
    recorder.start();
  });
}

// Long replies are spoken in sentence-sized chunks so the voice never stops
// halfway through.
function speechChunks(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["']?\s*|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if (current && `${current} ${part}`.length > 400) {
      chunks.push(current);
      current = part;
    } else {
      current = current ? `${current} ${part}` : part;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text];
}

/** The pieces to speak: a leading reaction on its own, then the rest in chunks. */
function speechQueue(text: string): SpeechSegment[] {
  const queue: SpeechSegment[] = [];
  for (const seg of speechSegments(text, BASE_VOICE)) {
    const plain = seg.pitch === BASE_VOICE.pitch && seg.rate === BASE_VOICE.rate && seg.pauseAfterMs === 0;
    if (plain) for (const chunk of speechChunks(seg.text)) queue.push({ ...seg, text: chunk });
    else queue.push(seg);
  }
  return queue;
}

export interface Speaker {
  /** Streamed reply text. Each finished sentence is spoken as soon as it is complete. */
  push: (text: string) => void;
  /** The text pushed so far turned out not to be the reply (it became actions): drop it. */
  retract: () => void;
  /** No more text. Speaks the unfinished tail (or the whole reply if nothing streamed). */
  end: (finalReply: string) => Promise<'done' | 'barged'>;
  /** Stop at once, without reporting an interruption. */
  cancel: () => void;
}

/**
 * Speaks a reply while it is still being written. Resolves from `end` with 'barged'
 * if the player talked over it. `onStart` fires when the first sound begins.
 */
export function createSpeaker(
  stream: MediaStream | null,
  hooks?: { onStart?: () => void; onBarge?: () => void },
): Speaker {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  let outcomeResolve: (o: 'done' | 'barged') => void = () => undefined;
  const outcome = new Promise<'done' | 'barged'>((r) => {
    outcomeResolve = r;
  });
  if (!synth) {
    return {
      push: () => undefined,
      retract: () => undefined,
      end: () => Promise.resolve('done'),
      cancel: () => undefined,
    };
  }
  let buffer = '';
  let queue: SpeechSegment[] = [];
  let settled = false;
  let ended = false;
  let running = false;
  let started = false;
  let spokeAny = false;
  let bargeTimer: number | undefined;
  let pauseTimer: number | undefined;
  let meter: MicMeter | null = null;
  let preferred: SpeechSynthesisVoice | null | undefined;

  const finish = (result: 'done' | 'barged') => {
    if (settled) return;
    settled = true;
    queue = [];
    if (bargeTimer !== undefined) window.clearInterval(bargeTimer);
    if (pauseTimer !== undefined) window.clearTimeout(pauseTimer);
    meter?.stop();
    outcomeResolve(result);
  };

  const startBargeWatch = () => {
    if (!stream) return;
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
          hooks?.onBarge?.();
          finish('barged');
        }
      }, 100);
    } catch {
      meter = null;
    }
  };

  const pump = () => {
    if (settled || running) return;
    const seg = queue.shift();
    if (!seg) {
      if (ended) finish('done');
      return;
    }
    running = true;
    if (!started) {
      started = true;
      startBargeWatch();
      hooks?.onStart?.();
    }
    if (preferred === undefined) {
      const voices = synth.getVoices();
      preferred =
        voices.find((v) => v.lang.toLowerCase().startsWith('en') && /natural|online|google/i.test(v.name)) ??
        voices.find((v) => v.lang.toLowerCase().startsWith('en')) ??
        null;
    }
    const utter = new SpeechSynthesisUtterance(seg.text);
    if (preferred) utter.voice = preferred;
    utter.rate = seg.rate;
    utter.pitch = seg.pitch;
    let fired = false;
    const next = () => {
      if (fired) return;
      fired = true;
      running = false;
      if (seg.pauseAfterMs > 0) pauseTimer = window.setTimeout(pump, seg.pauseAfterMs);
      else pump();
    };
    utter.onend = next;
    utter.onerror = next;
    synth.speak(utter);
  };

  const enqueue = (text: string) => {
    const pieces = speechQueue(text);
    if (pieces.length === 0) return;
    spokeAny = true;
    queue.push(...pieces);
  };

  synth.cancel();
  return {
    push(text) {
      if (settled || ended) return;
      buffer += text;
      const { complete, rest } = splitSentences(buffer);
      buffer = rest;
      for (const sentence of complete) enqueue(sentence);
      pump();
    },
    retract() {
      if (settled) return;
      buffer = '';
      queue = [];
      spokeAny = false;
      // Whatever sentence is mid-air is cut off; its end event moves on to the next.
      if (running) synth.cancel();
    },
    end(finalReply) {
      if (settled) return outcome;
      ended = true;
      if (buffer.trim()) enqueue(buffer);
      buffer = '';
      if (!spokeAny && finalReply.trim()) enqueue(finalReply);
      pump();
      return outcome;
    },
    cancel() {
      synth.cancel();
      finish('done');
    },
  };
}

/** Speaks a whole line. Resolves 'barged' if the player talked over it. */
export function speakText(text: string, stream: MediaStream | null): Promise<'done' | 'barged'> {
  return createSpeaker(stream).end(text);
}

export type LiveState = 'off' | 'listening' | 'thinking' | 'speaking';

export interface RespondHandlers {
  /** Reply text as it is written. */
  onDelta: (text: string) => void;
  /** Take back the text delivered since the last delta run (it became actions). */
  onRetract: () => void;
  /** Aborted when the player talks over Gaffer. */
  signal: AbortSignal;
}

const MAX_TURNS = 30;

/**
 * The hands-free loop: listen, transcribe, hand the words to `respond`, speak
 * what comes back as it arrives, repeat. It also ends the conversation: after a
 * goodbye ("bye", "that's all"), or after a stretch of silence (one check-in,
 * then a sign-off). The page owns the conversation (messages, history, API
 * calls); this owns the microphone and the speaker.
 */
export function useLiveConversation(opts: {
  transcribe: (wavDataUrl: string) => Promise<string>;
  /** Gets what the player said; streams the reply through the handlers; returns the final reply. Should not throw. */
  respond: (heard: string, handlers: RespondHandlers) => Promise<string>;
  /** Something the loop itself says (a farewell, a check-in), so the page can show it. `heard` is set when it answers something the player said. */
  onScripted?: (heard: string | null, say: string) => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<LiveState>('off');
  const [hearing, setHearing] = useState('');
  const activeRef = useRef(false);
  const stopCaptureRef = useRef<(() => void) | null>(null);
  const speakerRef = useRef<Speaker | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(
    () => () => {
      activeRef.current = false;
      stopCaptureRef.current?.();
      speakerRef.current?.cancel();
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const stop = useCallback(() => {
    activeRef.current = false;
    speakerRef.current?.cancel();
    window.speechSynthesis?.cancel();
    stopCaptureRef.current?.();
    setHearing('');
    setState('off');
  }, []);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    if (typeof MediaRecorder === 'undefined' || !window.speechSynthesis) {
      optsRef.current.onError('Live voice is not supported in this browser. Try Chrome or Edge.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      optsRef.current.onError('Microphone access was denied.');
      return;
    }
    activeRef.current = true;
    let turns = 0;
    let idleStrikes = 0;
    // Set when the player talks over Gaffer: the interruption is mid-sentence,
    // so the next capture listens with a shorter fuse.
    let interrupted = false;

    const say = async (heard: string | null, line: string) => {
      optsRef.current.onScripted?.(heard, line);
      setState('speaking');
      await speakText(line, stream);
    };

    try {
      while (activeRef.current && turns < MAX_TURNS) {
        turns += 1;
        setState('listening');
        let liveText = '';
        const stopInterim = startInterimListen((text) => {
          liveText = text;
          setHearing(text);
        });
        const capture = await captureUtterance(
          stream,
          (stopFn) => {
            stopCaptureRef.current = stopFn;
          },
          {
            getLiveText: () => liveText,
            idleMs: idleStrikes === 0 ? IDLE_FIRST_MS : IDLE_SECOND_MS,
            ...(interrupted ? { minSpeechMs: 200, fixedSilenceMs: 800 } : {}),
          },
        ).catch(() => null);
        stopInterim?.();
        setHearing('');
        interrupted = false;
        stopCaptureRef.current = null;
        if (!activeRef.current || !capture) break;

        if (capture.idle) {
          idleStrikes += 1;
          if (idleStrikes >= 2) {
            await say(null, IDLE_SIGN_OFF);
            break;
          }
          await say(null, CHECK_IN);
          continue;
        }
        idleStrikes = 0;

        setState('thinking');
        let heard = '';
        let heardError: string | null = null;
        try {
          heard = (await optsRef.current.transcribe(await blobToDataUrl(await recordingToWav(capture.blob)))).trim();
        } catch (err) {
          heardError = err instanceof Error ? err.message : null;
        }
        if (!activeRef.current) break;
        if (!heard) {
          // A server problem is not a hearing problem: say so instead of blaming the voice.
          const setupProblem =
            heardError && /not set up|transcription key|model key|could not reach/i.test(heardError);
          // Three different things used to sound the same: a server that is not set up, a request that failed
          // (asleep, offline, refused), and a clip with nothing in it. Only the last one is "I didn't catch that".
          const message =
            setupProblem && heardError
              ? heardError
              : heardError
                ? "I'm having trouble hearing you right now. Give it a moment and try again, or type to me."
                : "Sorry, I didn't catch that. Say that again?";
          await speakText(message, stream);
          continue;
        }

        // A goodbye ends the conversation without a round trip to the model.
        const ender = classifyEnder(heard);
        if (ender) {
          await say(heard, ender === 'hard' ? pick(FAREWELLS_HARD) : pick(FAREWELLS_SOFT));
          break;
        }

        const controller = new AbortController();
        const speaker = createSpeaker(stream, {
          onStart: () => setState('speaking'),
          onBarge: () => controller.abort(),
        });
        speakerRef.current = speaker;
        let reply = '';
        try {
          reply = await optsRef.current.respond(heard, {
            onDelta: speaker.push,
            onRetract: speaker.retract,
            signal: controller.signal,
          });
        } catch {
          reply = "Sorry, I couldn't get that done. Say that again?";
        }
        if (!activeRef.current) {
          speaker.cancel();
          break;
        }
        if (!reply.trim()) reply = "I couldn't get that done. Say that again?";
        interrupted = (await speaker.end(reply)) === 'barged';
        speakerRef.current = null;
      }
    } finally {
      activeRef.current = false;
      stopCaptureRef.current = null;
      speakerRef.current?.cancel();
      speakerRef.current = null;
      stream.getTracks().forEach((t) => t.stop());
      window.speechSynthesis?.cancel();
      setState('off');
      setHearing('');
    }
  }, []);

  return { state, hearing, active: state !== 'off', start, stop };
}
