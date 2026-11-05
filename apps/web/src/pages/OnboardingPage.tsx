import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { onboardingSchema, sportListSchema } from '@chabuka/shared';
import type { Level, Sport } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { askGaffer, transcribeVoiceNote } from '../lib/api';
import { blobToDataUrl, recordingToWav, speakReply, stopSpeaking } from '../lib/voice';

const LEVELS: { value: Level; label: string }[] = [
  { value: 'recreational', label: 'Recreational' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'competitive', label: 'Competitive' },
];

type SetupMode = 'wizard' | 'chat';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

const CHAT_INTRO: ChatMsg = {
  role: 'assistant',
  content: "I'm the Gaffer — tell me your name and we'll get your player card sorted, one question at a time.",
};

export default function OnboardingPage() {
  const { user, refreshProfile, signOut, session } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<SetupMode>('wizard');
  const [sports, setSports] = useState<Sport[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [town, setTown] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState('');
  const [level, setLevel] = useState<Level>('recreational');
  const [picked, setPicked] = useState<string[]>([]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [remoteAvatar, setRemoteAvatar] = useState<string | null>(null);
  const didPrefill = useRef(false);

  // Social sign-in prefill (Amendment 2, section 7): same profile row as
  // email, prefilled with name and photo where the provider supplies them.
  // Fills once so later typing is never clobbered.
  useEffect(() => {
    if (didPrefill.current || !user) return;
    didPrefill.current = true;
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const fullName = typeof meta['full_name'] === 'string' ? meta['full_name'].trim() : '';
    const givenName = typeof meta['name'] === 'string' ? meta['name'].trim() : '';
    const prefillName = fullName || givenName;
    if (prefillName) setName(prefillName);
    const avatar =
      typeof meta['avatar_url'] === 'string' && meta['avatar_url'].length > 0
        ? (meta['avatar_url'] as string)
        : typeof meta['picture'] === 'string' && meta['picture'].length > 0
          ? (meta['picture'] as string)
          : null;
    if (avatar) setRemoteAvatar(avatar);
  }, [user]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [chat, setChat] = useState<ChatMsg[]>([CHAT_INTRO]);
  const [draft, setDraft] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatDone, setChatDone] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]) as MutableRefObject<Blob[]>;

  // Leaving the chat (or the page) stops any spoken reply.
  useEffect(() => stopSpeaking, []);
  useEffect(() => {
    if (mode !== 'chat') stopSpeaking();
  }, [mode]);

  const sendChatText = async (raw: string) => {
    const text = raw.trim();
    const token = session?.access_token;
    if (!text || chatBusy || !token) return;
    const next = [...chat, { role: 'user' as const, content: text }];
    setChat(next);
    setDraft('');
    setChatBusy(true);
    setChatError(null);
    try {
      const turn = await askGaffer(text, next.slice(-10), token);
      setChat([...next, { role: 'assistant' as const, content: turn.reply }]);
      if (voiceOn) speakReply(turn.reply);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'The Gaffer went quiet. Try again.');
    } finally {
      setChatBusy(false);
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    const token = session?.access_token;
    if (!token || chatBusy) return;
    if (typeof MediaRecorder === 'undefined') {
      setChatError('Voice notes are not supported in this browser.');
      return;
    }
    setChatError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size === 0) return;
        setChatBusy(true);
        void recordingToWav(blob)
          .then((wav) => blobToDataUrl(wav))
          .then((dataUrl) => transcribeVoiceNote(dataUrl, token))
          .then(
            (heardRaw) => {
              const heard = (heardRaw ?? '').trim();
              if (!heard) throw new Error('Did not catch that — try again.');
              return sendChatText(heard);
            },
            (err: unknown) => {
              setChatError(err instanceof Error ? err.message : 'Could not transcribe that. Try again.');
            },
          )
          .finally(() => setChatBusy(false));
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setChatError('Recording failed. Try again.');
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setChatError('Microphone blocked. Allow mic access to talk instead of typing.');
    }
  };

  const checkCard = async () => {
    if (!user || !supabase) return;
    await refreshProfile();
    const { data } = await supabase.from('profiles').select('name').eq('id', user.id).maybeSingle();
    const done = !!data && !!((data as { name: string | null }).name);
    setChatDone(done);
    if (!done) setChatError('Card is still blank — give the Gaffer your name and area first.');
  };

  const stepError = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (step === 0 && (!name.trim() || !area.trim())) {
      setError('Add your name and area to continue.');
      return;
    }
    if (step === 1 && picked.length === 0) {
      setError('Pick at least one sport to continue.');
      return;
    }
    setStep((s) => Math.min(2, s + 1));
  };

  useEffect(() => {
    if (!supabase) {
      setLoadError('Supabase is not configured.');
      return;
    }
    supabase
      .from('sports')
      .select('id,name,formats')
      .order('name')
      .then(({ data, error: err }) => {
        if (err) {
          setLoadError(err.message);
          return;
        }
        const parsed = sportListSchema.safeParse(data);
        if (parsed.success) setSports(parsed.data);
        else setLoadError('Unexpected sports data from the server.');
      });
  }, []);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const toggleSport = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((s) => s !== id) : [...p, id]));

  const onPhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setPhotoFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setWarning(null);
    if (!supabase || !user) {
      setError('Not signed in.');
      return;
    }
    let photoUrl: string | undefined;
    if (photoFile) {
      const ext = photoFile.name.split('.').pop() ?? 'jpg';
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, photoFile, { upsert: true });
      if (upErr) {
        setWarning('Photo upload failed — continuing without a photo.');
      } else {
        photoUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      }
    }
    const parsed = onboardingSchema.safeParse({
      name: name.trim(),
      area: area.trim(),
      photoUrl: photoUrl ?? remoteAvatar ?? undefined,
      sportIds: picked,
      level,
      town: town.trim() || undefined,
      birthYear: birthYear ? Number(birthYear) : undefined,
      gender: gender.trim() || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }
    setBusy(true);
    try {
      const { error: pErr } = await supabase.from('profiles').upsert({
        id: user.id,
        name: parsed.data.name,
        area: parsed.data.area,
        city: parsed.data.town ?? null,
        birth_year: parsed.data.birthYear ?? null,
        gender: parsed.data.gender ?? null,
        photo_url: parsed.data.photoUrl ?? null,
      });
      if (pErr) throw pErr;
      const { error: dErr } = await supabase.from('user_sports').delete().eq('user_id', user.id);
      if (dErr) throw dErr;
      const rows = parsed.data.sportIds.map((sport_id) => ({
        user_id: user.id,
        sport_id,
        level: parsed.data.level,
      }));
      const { error: iErr } = await supabase.from('user_sports').insert(rows);
      if (iErr) throw iErr;
      await refreshProfile();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow floodlight">
      <div className="page-head">
        <span className="eyebrow eyebrow-accent">First whistle</span>
        <h1>Your player profile</h1>
        <p>Thirty seconds, then you are in.</p>
      </div>
      {loadError ? <p className="error">{loadError}</p> : null}
      <div className="chips" role="group" aria-label="Setup style">
        <button
          type="button"
          className={mode === 'wizard' ? 'chip chip-active' : 'chip'}
          aria-pressed={mode === 'wizard'}
          onClick={() => setMode('wizard')}
        >
          Step by step
        </button>
        <button
          type="button"
          className={mode === 'chat' ? 'chip chip-active' : 'chip'}
          aria-pressed={mode === 'chat'}
          onClick={() => setMode('chat')}
        >
          Chat with the Gaffer
        </button>
      </div>
      {mode === 'wizard' ? (
      <>
      <div className="wizard-dots" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i <= step ? 'wizard-dot wizard-dot-done' : 'wizard-dot'} />
        ))}
      </div>
      <form
        className="card"
        onSubmit={(e) => {
          if (step < 2) stepError(e);
          else void submit(e);
        }}
      >
        {step === 0 ? (
          <>
            <h2>Who are you?</h2>
            <label className="field">
              Name
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                maxLength={80}
              />
            </label>
            <label className="field">
              Photo (optional)
              <input className="input" type="file" accept="image/*" onChange={onPhoto} />
            </label>
            {preview ?? remoteAvatar ? (
              <img
                className="avatar-preview"
                src={(preview ?? remoteAvatar) as string}
                alt="Profile photo preview"
              />
            ) : null}
            <label className="field">
              Area
              <input
                className="input"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="e.g. Woodlands"
                maxLength={80}
              />
            </label>
            <label className="field">
              Town / locality (optional)
              <input
                className="input"
                value={town}
                onChange={(e) => setTown(e.target.value)}
                placeholder="e.g. Lusaka"
                maxLength={80}
              />
            </label>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <h2>What do you play?</h2>
            <div className="field">
              <span>My sports</span>
              <div className="chips">
                {sports.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={picked.includes(s.id) ? 'chip chip-active' : 'chip'}
                    onClick={() => toggleSport(s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>Level</span>
              <div className="chips">
                {LEVELS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    className={level === l.value ? 'chip chip-active' : 'chip'}
                    onClick={() => setLevel(l.value)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <h2>Almost done</h2>
            <p className="muted">Optional — helps place you in the right games.</p>
            <label className="field">
              Year of birth (shown only as an age band)
              <input
                className="input"
                inputMode="numeric"
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
                placeholder="e.g. 1998"
                maxLength={4}
              />
            </label>
            <label className="field">
              Gender (optional)
              <input
                className="input"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                placeholder="How you describe yourself"
                maxLength={40}
              />
            </label>
          </>
        ) : null}
        {warning ? <p className="hint">{warning}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <div className="wizard-nav">
          {step > 0 ? (
            <button className="btn" type="button" onClick={() => { setError(null); setStep((s) => s - 1); }}>
              Back
            </button>
          ) : null}
          {step < 2 ? (
            <button className="btn btn-primary" type="submit">
              Continue
            </button>
          ) : (
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Start playing'}
            </button>
          )}
        </div>
      </form>
      </>
      ) : (
      <div className="card">
        <h2>Set up with the Gaffer</h2>
        <p className="muted">Talk it through — name, area, sports — and it writes your card as you go.</p>
        <div className="chat-log" aria-live="polite">
          {chat.map((m, i) => (
            <p key={i} className={m.role === 'user' ? 'chat-user' : 'chat-gaffer'}>
              {m.content}
            </p>
          ))}
          {chatBusy ? <p className="muted">The Gaffer is thinking…</p> : null}
        </div>
        {chatError ? <p className="error">{chatError}</p> : null}
        {chatDone ? (
          <>
            <p className="hint">Card sorted. Welcome in.</p>
            <button className="btn btn-primary" type="button" onClick={() => navigate('/', { replace: true })}>
              Head home
            </button>
          </>
        ) : (
          <>
            <label className="field">
              Message the Gaffer
              <input
                className="input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="e.g. I'm Chanda from Kabulonga, I play football"
                maxLength={500}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void sendChatText(draft);
                  }
                }}
              />
            </label>
            {recording ? <p className="hint" role="status">Listening… tap the mic to finish.</p> : null}
            <div className="actions-row">
              <button className="btn btn-primary" type="button" disabled={chatBusy || !draft.trim()} onClick={() => { void sendChatText(draft); }}>
                {chatBusy ? 'Sending…' : 'Send'}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={chatBusy && !recording}
                onClick={() => { void toggleRecording(); }}
                aria-pressed={recording}
                aria-label={recording ? 'Stop recording' : 'Talk instead of typing'}
              >
                {recording ? 'Stop' : 'Talk'}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setVoiceOn((v) => {
                    if (v) stopSpeaking();
                    return !v;
                  });
                }}
                aria-pressed={voiceOn}
                aria-label={voiceOn ? 'Mute the Gaffer' : 'Hear the Gaffer'}
              >
                {voiceOn ? 'Sound on' : 'Muted'}
              </button>
              <button className="btn btn-ghost" type="button" disabled={chatBusy} onClick={() => { void checkCard(); }}>
                Check my card
              </button>
            </div>
          </>
        )}
      </div>
      )}
      <button
        className="btn btn-ghost"
        type="button"
        onClick={() => {
          void signOut();
        }}
      >
        Use a different account
      </button>
    </div>
  );
}
