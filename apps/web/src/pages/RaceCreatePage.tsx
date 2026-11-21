import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { CATEGORY_LABELS, COMPETITION_CATEGORIES, DEFAULT_AGE_BANDS, RACE_PRESETS, createRaceSchema, formatMoney } from '@chabuka/shared';
import type { CompetitionCategory, Sport, Wave } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { runAction } from '../lib/api';
import { fetchSports } from '../lib/matches';
import { Badge, Button, Card, Chip, ErrorNote, PageHeader, cx } from '../components/ui';
import { EventDetailsFields, Field, detailsToInput, emptyDetails, fieldCls } from '../components/CompetitionForms';
import type { EventDetails } from '../components/CompetitionForms';

// Organise a race: what kind, the distances (fee, field size, start time, bibs), the event details (banner, host,
// cause, sponsors later), and registration (waiver, waves, closing date). The course for each distance is drawn on
// the race page right after, where the distances already exist.

interface DistanceDraft {
  name: string;
  km: string;
  laps: number;
  time: string;
  cutoff: string;
  minAge: string;
  limit: string;
  price: string;
  bibFrom: string;
  bibTo: string;
}

const STEPS = ['Race', 'Distances', 'Details', 'Registration', 'Review'];

function draftFor(preset: (typeof RACE_PRESETS)[number], index: number): DistanceDraft {
  const from = index * 1000 + 1;
  return {
    name: preset.label,
    km: String(preset.km),
    laps: 1,
    time: preset.key === 'full' || preset.key === 'half' ? '05:30' : '07:00',
    cutoff: preset.key === 'full' ? '360' : preset.key === 'half' ? '210' : '',
    minAge: preset.key === 'full' || preset.key === 'half' ? '18' : '',
    limit: '500',
    price: '',
    bibFrom: String(from),
    bibTo: String(from + 998),
  };
}

export default function RaceCreatePage() {
  const navigate = useNavigate();
  const { session, profile } = useAuth();
  const token = session?.access_token ?? '';
  const [step, setStep] = useState(0);
  const [sports, setSports] = useState<Sport[]>([]);
  const [name, setName] = useState('');
  const [trail, setTrail] = useState(false);
  const [category, setCategory] = useState<CompetitionCategory>('community');
  const [area, setArea] = useState(profile?.area ?? '');
  const [date, setDate] = useState('');
  const [distances, setDistances] = useState<DistanceDraft[]>([]);
  const [details, setDetails] = useState<EventDetails>(emptyDetails);
  const [waiver, setWaiver] = useState(
    'I am fit to take part and take part at my own risk. I agree to follow the marshals and the race rules, and I allow the organiser to use photos taken on the day.',
  );
  const [closes, setCloses] = useState('');
  const [tshirts, setTshirts] = useState(true);
  const [pack, setPack] = useState('');
  const [waves, setWaves] = useState<Wave[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSports().then(setSports).catch(() => setSports([]));
  }, []);

  const sportId = sports.find((s) => s.name.toLowerCase() === (trail ? 'hiking' : 'marathon'))?.id ?? sports.find((s) => s.name.toLowerCase() === 'marathon')?.id ?? '';
  const setD = (i: number, patch: Partial<DistanceDraft>) => setDistances((list) => list.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const addPreset = (p: (typeof RACE_PRESETS)[number]) => {
    if (p.key === 'trail') setTrail(true);
    setDistances((list) => [...list, draftFor(p, list.length)]);
  };

  const build = () => {
    const iso = (t: string) => (date ? new Date(`${date}T${t || '06:00'}:00+02:00`).toISOString() : '');
    return {
      name: name.trim(),
      sportId,
      category,
      area: area.trim(),
      startsOn: date,
      distances: distances.map((d) => ({
        name: d.name.trim(),
        km: Number(d.km),
        laps: d.laps,
        startsAt: iso(d.time),
        cutoffMinutes: d.cutoff ? Number(d.cutoff) : null,
        minAge: d.minAge ? Number(d.minAge) : null,
        fieldLimit: Number(d.limit) || 0,
        price: d.price ? Number(d.price) : 0,
        currency: 'ZMW',
        bibFrom: Number(d.bibFrom) || 0,
        bibTo: Number(d.bibTo) || 0,
      })),
      settings: { waiverText: waiver.trim(), ageBands: DEFAULT_AGE_BANDS, waves, tshirts, packCollection: pack.trim() },
      registrationClosesAt: closes ? new Date(closes).toISOString() : null,
      ...detailsToInput(details),
    };
  };

  const check = (upTo: number): string | null => {
    const parsed = createRaceSchema.safeParse(build());
    if (parsed.success) return null;
    const issue = parsed.error.issues.find((i) => {
      const top = String(i.path[0] ?? '');
      if (upTo === 0) return ['name', 'sportId', 'area', 'startsOn', 'category'].includes(top);
      if (upTo === 1) return ['name', 'sportId', 'area', 'startsOn', 'distances'].includes(top);
      return true;
    });
    return issue ? issue.message : null;
  };

  const next = () => {
    const problem = check(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const create = async () => {
    const problem = check(9);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await runAction<{ competitionId: string }>('create_race', build(), token);
      navigate(`/races/${r.competitionId}?tab=manage&setup=route`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the race.');
    } finally {
      setBusy(false);
    }
  };

  const anyPaid = distances.some((d) => Number(d.price) > 0);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-28 pt-4">
      <PageHeader title="Organise a race" back="/competitions" sub={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`} />
      <div className="flex gap-1" aria-hidden="true">
        {STEPS.map((s, i) => (
          <span key={s} className={cx('h-1.5 flex-1 rounded-full', i <= step ? 'bg-brand' : 'bg-surface-2')} />
        ))}
      </div>

      {step === 0 ? (
        <div className="flex flex-col gap-4">
          <Field label="Race name">
            <input className={fieldCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Lusaka City Marathon 2026" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Race date">
              <input type="date" className={fieldCls} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Town or area">
              <input className={fieldCls} value={area} maxLength={80} onChange={(e) => setArea(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-col gap-1.5 text-[13px] font-semibold">
            Kind of event
            <div className="flex flex-wrap gap-2">
              {COMPETITION_CATEGORIES.map((c) => (
                <Chip key={c} on={category === c} onClick={() => setCategory(c)}>
                  {CATEGORY_LABELS[c]}
                </Chip>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[14px] font-semibold">
            <input type="checkbox" checked={trail} onChange={(e) => setTrail(e.target.checked)} className="h-5 w-5" />
            Trail or hiking event (off-road)
          </label>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {RACE_PRESETS.map((p) => (
              <Button key={p.key} size="sm" icon={<Plus size={15} />} onClick={() => addPreset(p)}>
                {p.label}
              </Button>
            ))}
          </div>
          {distances.length === 0 ? <Card className="p-4 text-[14px] text-muted">Add the distances runners can choose. You can change everything later.</Card> : null}
          {distances.map((d, i) => (
            <Card key={i} className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2">
                <input className={cx(fieldCls, 'font-bold')} value={d.name} maxLength={40} onChange={(e) => setD(i, { name: e.target.value })} aria-label="Distance name" />
                <Button size="sm" variant="ghost" aria-label="Remove distance" onClick={() => setDistances((l) => l.filter((_, j) => j !== i))}>
                  <Trash2 size={16} />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Km">
                  <input className={fieldCls} inputMode="decimal" value={d.km} onChange={(e) => setD(i, { km: e.target.value })} />
                </Field>
                <Field label="Start time">
                  <input type="time" className={fieldCls} value={d.time} onChange={(e) => setD(i, { time: e.target.value })} />
                </Field>
                <Field label="Field limit">
                  <input className={fieldCls} inputMode="numeric" value={d.limit} onChange={(e) => setD(i, { limit: e.target.value })} />
                </Field>
                <Field label="Entry fee (ZMW)" hint="Empty = free">
                  <input className={fieldCls} inputMode="decimal" value={d.price} onChange={(e) => setD(i, { price: e.target.value })} placeholder="0" />
                </Field>
                <Field label="Cut-off (min)">
                  <input className={fieldCls} inputMode="numeric" value={d.cutoff} onChange={(e) => setD(i, { cutoff: e.target.value })} />
                </Field>
                <Field label="Minimum age">
                  <input className={fieldCls} inputMode="numeric" value={d.minAge} onChange={(e) => setD(i, { minAge: e.target.value })} />
                </Field>
                <Field label="First bib">
                  <input className={fieldCls} inputMode="numeric" value={d.bibFrom} onChange={(e) => setD(i, { bibFrom: e.target.value })} />
                </Field>
                <Field label="Last bib">
                  <input className={fieldCls} inputMode="numeric" value={d.bibTo} onChange={(e) => setD(i, { bibTo: e.target.value })} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-[13px] font-semibold">
                Laps of the course
                <select className="h-9 rounded-lg border border-line bg-surface px-2" value={d.laps} onChange={(e) => setD(i, { laps: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </Card>
          ))}
          {anyPaid ? <p className="m-0 text-[13px] text-muted">Paid entries are sold through WaitApp: runners pay there and their bib appears here once paid.</p> : null}
        </div>
      ) : null}

      {step === 2 ? <EventDetailsFields value={details} onChange={setDetails} category={category} folder={`competitions/new-${profile?.id ?? 'me'}`} /> : null}

      {step === 3 ? (
        <div className="flex flex-col gap-4">
          <Field label="Waiver runners accept">
            <textarea className={cx(fieldCls, 'h-28 py-2')} maxLength={5000} value={waiver} onChange={(e) => setWaiver(e.target.value)} />
          </Field>
          <Field label="Entries close (optional)">
            <input type="datetime-local" className={fieldCls} value={closes} onChange={(e) => setCloses(e.target.value)} />
          </Field>
          <Field label="Race-pack collection (optional)" hint="Where and when runners collect bibs and T-shirts.">
            <input className={fieldCls} value={pack} maxLength={500} onChange={(e) => setPack(e.target.value)} placeholder="Friday 4 Dec, 10:00-18:00, East Park Mall" />
          </Field>
          <label className="flex items-center gap-2 text-[14px] font-semibold">
            <input type="checkbox" checked={tshirts} onChange={(e) => setTshirts(e.target.checked)} className="h-5 w-5" />
            Ask for a T-shirt size
          </label>
          <Card className="flex flex-col gap-2 p-4">
            <strong className="text-[14px]">Start waves (optional)</strong>
            <p className="m-0 text-[13px] text-muted">Runners are placed by the finish time they expect. Leave empty for one start.</p>
            {waves.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className={fieldCls} value={w.label} maxLength={30} onChange={(e) => setWaves((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Wave name" />
                <input
                  className={fieldCls}
                  inputMode="numeric"
                  placeholder="Under (minutes)"
                  value={w.maxMinutes ?? ''}
                  onChange={(e) => setWaves((l) => l.map((x, j) => (j === i ? { ...x, maxMinutes: e.target.value ? Number(e.target.value) : null } : x)))}
                  aria-label="Expected finish under (minutes)"
                />
                <Button size="sm" variant="ghost" aria-label="Remove wave" onClick={() => setWaves((l) => l.filter((_, j) => j !== i))}>
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
            <Button size="sm" icon={<Plus size={15} />} className="self-start" onClick={() => setWaves((l) => [...l, { label: `Wave ${String.fromCharCode(65 + l.length)}`, maxMinutes: null }])}>
              Add a wave
            </Button>
          </Card>
        </div>
      ) : null}

      {step === 4 ? (
        <Card className="flex flex-col gap-2 p-4 text-[14px]">
          <strong className="text-[17px]">{name || 'Untitled race'}</strong>
          <span className="text-muted">
            {date} · {area} · {CATEGORY_LABELS[category]}
          </span>
          {distances.map((d, i) => (
            <div key={i} className="flex items-center justify-between border-t border-line pt-2">
              <span className="font-semibold">
                {d.name} <span className="font-normal text-muted">{d.km} km, {d.time}</span>
              </span>
              <Badge tone={Number(d.price) > 0 ? 'neutral' : 'brand'}>{Number(d.price) > 0 ? formatMoney(d.price, 'ZMW') : 'Free'}</Badge>
            </div>
          ))}
          <p className="m-0 pt-2 text-[13px] text-muted">Next you draw each course on the map{anyPaid ? ' and put paid entries on sale through WaitApp' : ''}.</p>
        </Card>
      ) : null}

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex gap-2">
        {step > 0 ? <Button onClick={() => setStep((s) => s - 1)}>Back</Button> : null}
        {step < STEPS.length - 1 ? (
          <Button variant="primary" block onClick={next}>
            Continue
          </Button>
        ) : (
          <Button variant="primary" block disabled={busy} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create race'}
          </Button>
        )}
      </div>
    </div>
  );
}
