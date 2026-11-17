import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { TSHIRT_SIZES, ageOn, formatDuration, venueTime, venueYmd } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { runAction } from '../lib/api';
import { fetchRace } from '../lib/races';
import type { RaceView } from '../lib/races';
import { Badge, Button, ButtonLink, Card, Chip, ErrorNote, PageHeader, Segmented, Skeleton, cx } from '../components/ui';
import { Field, fieldCls } from '../components/CompetitionForms';

// Enter a race: pick a distance, fill in the runner (yourself or someone else, like your child or a colleague),
// accept the waiver. Free distances confirm at once with a bib; paid ones go to WaitApp to pay, and the bib follows.

type Result = { state: 'confirmed'; bib: number } | { state: 'pending_payment'; checkoutUrl: string; holdMinutes: number };

export default function RaceEnterPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { session, profile } = useAuth();
  const token = session?.access_token ?? '';
  const [view, setView] = useState<RaceView | null>(null);
  const [distanceId, setDistanceId] = useState(params.get('distance') ?? '');
  const [forMe, setForMe] = useState<'me' | 'other'>('me');
  const [name, setName] = useState(profile?.name ?? '');
  const [gender, setGender] = useState<'female' | 'male' | ''>('');
  const [birth, setBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [iceName, setIceName] = useState('');
  const [icePhone, setIcePhone] = useState('');
  const [tshirt, setTshirt] = useState('');
  const [club, setClub] = useState('');
  const [expected, setExpected] = useState('');
  const [medical, setMedical] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [waiver, setWaiver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchRace(token, id)
      .then((v) => {
        setView(v);
        setDistanceId((cur) => cur || v.distances[0]?.id || '');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the race.'));
  }, [token, id]);

  useEffect(() => {
    setName(forMe === 'me' ? (profile?.name ?? '') : '');
  }, [forMe, profile?.name]);

  if (!view) return <div className="mx-auto max-w-xl px-4 pt-4">{error ? <ErrorNote>{error}</ErrorNote> : <Skeleton className="h-64" />}</div>;
  const d = view.distances.find((x) => x.id === distanceId);
  const age = birth && d ? ageOn(birth, venueYmd(d.starts_at)) : null;
  const tooYoung = age != null && d?.min_age != null && age < d.min_age;
  // "1:55" = 1 hour 55 minutes.
  const hm = /^(\d{1,2}):([0-5]\d)$/.exec(expected.trim());
  const expectedMinutes = hm ? Number(hm[1]) * 60 + Number(hm[2]) : null;

  const submit = async () => {
    if (!d) return;
    setBusy(true);
    setError(null);
    try {
      const r = await runAction<Result>(
        'enter_race',
        {
          competitionId: view.race.id,
          distanceId: d.id,
          runnerName: name.trim(),
          gender,
          birthDate: birth,
          phone: phone.trim(),
          emergencyName: iceName.trim(),
          emergencyPhone: icePhone.trim(),
          tshirt: tshirt || null,
          ...(club.trim() ? { club: club.trim() } : {}),
          expectedMinutes,
          ...(medical.trim() ? { medicalNote: medical.trim() } : {}),
          answers: (view.race.registration_questions ?? []).map((q) => ({ label: q.label, answer: (answers[q.label] ?? '').trim() })),
          acceptWaiver: waiver,
        },
        token,
      );
      if (r.state === 'pending_payment') {
        window.location.assign(r.checkoutUrl);
        return;
      }
      setDone(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enter.');
    } finally {
      setBusy(false);
    }
  };

  if (done?.state === 'confirmed') {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-4 pb-24 pt-10 text-center">
        <CheckCircle2 size={44} className="text-brand-text" />
        <h1 className="m-0">{name.split(' ')[0]} is in</h1>
        <p className="m-0 text-muted">
          {view.race.name}, {d?.name}
        </p>
        <span className="rounded-2xl bg-ink px-6 py-3 font-mono text-[40px] font-extrabold text-bg">{done.bib}</span>
        <p className="m-0 text-[14px] text-muted">Bib number{view.settings.packCollection ? `. Collect your race pack: ${view.settings.packCollection}` : ''}</p>
        <div className="flex gap-2">
          <ButtonLink to={`/races/${view.race.id}?tab=route`} variant="primary">See the course</ButtonLink>
          <Button onClick={() => { setDone(null); setForMe('other'); setWaiver(false); }}>Enter someone else</Button>
        </div>
      </div>
    );
  }

  const ready = !!d && name.trim().length >= 2 && !!gender && !!birth && !tooYoung && phone.trim().length >= 6 && iceName.trim().length >= 2 && icePhone.trim().length >= 6 && waiver && (!view.settings.tshirts || !!tshirt);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-28 pt-4">
      <PageHeader title={`Enter ${view.race.name}`} back={`/races/${view.race.id}`} />
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">Distance</span>
        <div className="flex flex-wrap gap-2">
          {view.distances.map((x) => (
            <Chip key={x.id} on={x.id === distanceId} onClick={() => setDistanceId(x.id)}>
              {x.name} · {x.price > 0 ? `${x.currency} ${x.price}` : 'Free'}
            </Chip>
          ))}
        </div>
        {d ? (
          <span className="text-[13px] text-muted">
            Starts {venueTime(d.starts_at)}
            {d.cutoff_minutes ? `, cut-off ${formatDuration(d.cutoff_minutes * 60)}` : ''}
            {d.min_age ? `, ${d.min_age}+ on race day` : ''}
          </span>
        ) : null}
      </div>

      <Segmented<'me' | 'other'> label="Who is running" value={forMe} onChange={setForMe} options={[{ value: 'me', label: 'Me' }, { value: 'other', label: 'Someone else' }]} />

      <Card className="flex flex-col gap-3.5 p-4">
        <Field label="Runner's full name" hint="As it should appear in the results">
          <input className={fieldCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete={forMe === 'me' ? 'name' : 'off'} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Segmented<'female' | 'male' | ''> label="Category" value={gender} onChange={setGender} options={[{ value: 'female', label: 'Women' }, { value: 'male', label: 'Men' }]} />
          </Field>
          <Field label="Date of birth">
            <input type="date" className={fieldCls} value={birth} onChange={(e) => setBirth(e.target.value)} />
          </Field>
        </div>
        {tooYoung ? <ErrorNote>The {d?.name} is for runners aged {d?.min_age} and over on race day.</ErrorNote> : null}
        <Field label="Phone for race-day messages">
          <input className={fieldCls} value={phone} maxLength={30} inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Emergency contact">
            <input className={fieldCls} value={iceName} maxLength={80} onChange={(e) => setIceName(e.target.value)} />
          </Field>
          <Field label="Their phone">
            <input className={fieldCls} value={icePhone} maxLength={30} inputMode="tel" onChange={(e) => setIcePhone(e.target.value)} />
          </Field>
        </div>
        {view.settings.tshirts ? (
          <div className="flex flex-col gap-1.5 text-[13px] font-semibold">
            T-shirt size
            <div className="flex flex-wrap gap-2">
              {TSHIRT_SIZES.map((s) => (
                <Chip key={s} on={tshirt === s} onClick={() => setTshirt(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Club or company (optional)">
            <input className={fieldCls} value={club} maxLength={80} onChange={(e) => setClub(e.target.value)} />
          </Field>
          <Field label="Expected finish (optional)" hint={view.settings.waves.length ? 'Puts you in a start wave' : 'h:mm'}>
            <input className={fieldCls} value={expected} maxLength={8} onChange={(e) => setExpected(e.target.value)} placeholder="1:55" />
          </Field>
        </div>
        <Field label="Medical information for the medics (optional)">
          <input className={fieldCls} value={medical} maxLength={500} onChange={(e) => setMedical(e.target.value)} placeholder="Asthma, allergies, medication" />
        </Field>
        {(view.race.registration_questions ?? []).map((q) => (
          <Field key={q.label} label={`${q.label}${q.required ? '' : ' (optional)'}`}>
            <input className={fieldCls} maxLength={1000} value={answers[q.label] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.label]: e.target.value })} />
          </Field>
        ))}
      </Card>

      {view.settings.waiverText ? (
        <Card className="flex flex-col gap-2 p-4">
          <strong className="text-[14px]">Waiver</strong>
          <p className="m-0 whitespace-pre-line text-[13px] text-muted">{view.settings.waiverText}</p>
          <label className="flex items-center gap-2 text-[14px] font-semibold">
            <input type="checkbox" checked={waiver} onChange={(e) => setWaiver(e.target.checked)} className="h-5 w-5" />
            {forMe === 'me' ? 'I accept' : 'I accept on behalf of the runner (as their parent, guardian or with their agreement)'}
          </label>
        </Card>
      ) : (
        <label className="flex items-center gap-2 text-[14px] font-semibold">
          <input type="checkbox" checked={waiver} onChange={(e) => setWaiver(e.target.checked)} className="h-5 w-5" />
          The runner takes part at their own risk
        </label>
      )}

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className={cx('sticky bottom-20 flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-sm lg:bottom-4')}>
        <div className="flex-1">
          <span className="block text-[13px] text-muted">{d?.name}</span>
          <strong>{d && d.price > 0 ? `${d.currency} ${d.price}` : 'Free'}</strong>
          {d && d.price > 0 ? <Badge tone="muted" className="ml-2">Paid on WaitApp</Badge> : null}
        </div>
        <Button variant="primary" disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? 'Sending…' : d && d.price > 0 ? 'Continue to payment' : 'Enter'}
        </Button>
      </div>
    </div>
  );
}
