// Shared browser voice helpers. Meta's transcribe endpoint only takes WAV
// (mono 16-bit PCM); the mic usually records webm/opus, so decode it here
// and re-encode 16 kHz mono WAV — no server ffmpeg needed.
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

export async function recordingToWav(blob: Blob): Promise<Blob> {
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

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' && reader.result
        ? resolve(reader.result)
        : reject(new Error('Could not read the recording.'));
    reader.onerror = () => reject(new Error('Could not read the recording.'));
    reader.readAsDataURL(blob);
  });
}

// Speak one reply with the device's own voices. Kept simple on purpose:
// the onboarding chat has no barge-in engine, so starting a new turn or
// leaving the page stops the voice.
export function speakReply(text: string): void {
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const voices = synth.getVoices();
  const preferred =
    voices.find((v) => v.lang.toLowerCase().startsWith('en') && /natural|online|google/i.test(v.name)) ??
    voices.find((v) => v.lang.toLowerCase().startsWith('en')) ??
    null;
  const utter = new SpeechSynthesisUtterance(text.slice(0, 400));
  if (preferred) utter.voice = preferred;
  utter.rate = 1;
  synth.speak(utter);
}

export function stopSpeaking(): void {
  window.speechSynthesis?.cancel();
}
