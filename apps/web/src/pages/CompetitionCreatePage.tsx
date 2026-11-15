import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building, ChevronLeft, GraduationCap, HandHeart, PartyPopper, Trophy, Users } from 'lucide-react';
import { CATEGORY_LABELS, COMPETITION_FORMATS, FORMAT_HELP, FORMAT_LABELS, createCompetitionV2Schema } from '@chabuka/shared';
import type { CompetitionCategory, CompetitionFormat, Sport } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { runAction } from '../lib/api';
import { fetchSports } from '../lib/matches';
import { sportLabel } from '../components/GameCard';
import { Badge, Button, Card, ErrorNote, Segmented, cx } from '../components/ui';
import {
  EventDetailsFields,
  Field,
  RegistrationFields,
  detailsToInput,
  emptyDetails,
  fieldCls,
  registrationToInput,
} from '../components/CompetitionForms';
import type { EventDetails, RegistrationSettings } from '../components/CompetitionForms';

const CATEGORIES: { value: CompetitionCategory; icon: typeof Users; blurb: string }[] = [
  { value: 'community', icon: Users, blurb: 'Neighbourhood leagues and open tournaments' },
  { value: 'charity', icon: HandHeart, blurb: 'Raise money or awareness for a cause' },
  { value: 'corporate', icon: Building, blurb: 'Company and inter-office leagues and fun days' },
  { value: 'school', icon: GraduationCap, blurb: 'Schools, colleges and age groups' },
  { value: 'social', icon: PartyPopper, blurb: 'Friendly cups, socials and one-day events' },
];

const STEPS = ['Type', 'Format', 'Details', 'Registration', 'Review'];

export default function CompetitionCreatePage() {
  const navigate = useNavigate();
  const { session, profile } = useAuth();
  const token = session?.access_token;
  const [step, setStep] = useState(0);
  const [sports, setSports] = useState<Sport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [category, setCategory] = useState<CompetitionCategory>('community');
  const [kind, setKind] = useState<'tournament' | 'league'>('tournament');
  const [sportId, setSportId] = useState('');
  const [format, setFormat] = useState<CompetitionFormat>('round_robin');
  const [name, setName] = useState('');
  const [area, setArea] = useState(profile?.area ?? '');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [maxEntries, setMaxEntries] = useState(8);
  const [groupCount, setGroupCount] = useState(2);
  const [advance, setAdvance] = useState(2);
  const [details, setDetails] = useState<EventDetails>(emptyDetails);
  const [registration, setRegistration] = useState<RegistrationSettings>({ requiresApproval: true, closesAt: '', teamSizeMin: '', teamSizeMax: '', questions: [] });

  useEffect(() => {
    fetchSports()
      .then((list) => {
        setSports(list);
        if (list[0]) setSportId((s) => s || list[0]!.id);
      })
      .catch(() => undefined);
  }, []);

  // Corporate and charity events usually want to vet entries and ask questions.
  useEffect(() => {
    setRegistration((r) =>
      r.questions.length === 0 && category === 'corporate'
        ? { ...r, questions: [{ label: 'Company or department', required: true }] }
        : r,
    );
  }, [category]);

  const payload = () => ({
    name: name.trim(),
    sportId,
    kind,
    format,
    category,
    area: area.trim(),
    startsOn,
    endsOn: endsOn || undefined,
    maxEntries,
    groupCount: format === 'groups_knockout' ? groupCount : undefined,
    advancePerGroup: format === 'groups_knockout' ? advance : undefined,
    ...detailsToInput(details),
    ...registrationToInput(registration),
  });

  const check = (upTo: number): string | null => {
    if (upTo >= 1 && !sportId) return 'Pick a sport.';
    if (upTo >= 2) {
      if (!name.trim()) return 'Give it a name.';
      if (!area.trim()) return 'Add the area.';
      if (!startsOn) return 'Pick a start date.';
      if (format === 'groups_knockout' && maxEntries < groupCount * 2) return `${groupCount} groups need at least ${groupCount * 2} teams.`;
    }
    return null;
  };

  const next = () => {
    const problem = check(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
    window.scrollTo({ top: 0 });
  };

  const publish = async () => {
    if (!token) return;
    const parsed = createCompetitionV2Schema.safeParse(payload());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the details.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await runAction<{ competitionId: string }>('create_competition', parsed.data, token);
      navigate(`/competitions/${res.competitionId}?tab=manage`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create it.');
    } finally {
      setBusy(false);
    }
  };

  const sport = sports.find((s) => s.id === sportId);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5 px-4 pb-32 pt-4">
      <header className="flex items-start gap-2">
        <button
          type="button"
          aria-label="Back"
          onClick={() => (step === 0 ? navigate(-1) : setStep((s) => s - 1))}
          className="-ml-2 mt-0.5 flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-ink hover:bg-surface-2"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="m-0">Run a league or tournament</h1>
          <p className="m-0 text-[13px] text-muted">
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </p>
        </div>
      </header>
      <ol className="m-0 grid list-none grid-cols-5 gap-1.5 p-0" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? 'step' : undefined}>
            <span className={cx('block h-1.5 rounded-full', i <= step ? 'bg-brand' : 'bg-surface-3')} />
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">What kind of event?</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {CATEGORIES.map((c) => {
                const on = category === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setCategory(c.value)}
                    className={cx(
                      'flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 text-left',
                      on ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:bg-surface-2',
                    )}
                  >
                    <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', on ? 'bg-brand text-on-brand' : 'bg-surface-2 text-ink')}>
                      <c.icon size={20} />
                    </span>
                    <span className="flex flex-col">
                      <strong className="text-ink">{CATEGORY_LABELS[c.value]}</strong>
                      <span className="text-[13px] text-muted">{c.blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">Is it a league or a tournament?</span>
            <Segmented<'tournament' | 'league'>
              label="League or tournament"
              value={kind}
              onChange={(v) => {
                setKind(v);
                setFormat(v === 'league' ? 'round_robin' : 'knockout');
              }}
              options={[
                { value: 'tournament', label: 'Tournament (a day or a few)' },
                { value: 'league', label: 'League (a season)' },
              ]}
            />
          </div>
          <Field label="Sport">
            <select className={fieldCls} value={sportId} onChange={(e) => setSportId(e.target.value)}>
              {sports.map((s) => (
                <option key={s.id} value={s.id}>
                  {sportLabel(s.name)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">Format</span>
            {COMPETITION_FORMATS.map((f) => {
              const on = format === f;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFormat(f)}
                  className={cx('flex cursor-pointer flex-col gap-0.5 rounded-2xl border p-3.5 text-left', on ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:bg-surface-2')}
                >
                  <strong className="text-ink">{FORMAT_LABELS[f]}</strong>
                  <span className="text-[13px] text-muted">{FORMAT_HELP[f]}</span>
                </button>
              );
            })}
          </div>
          <Field label="Name">
            <input className={fieldCls} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={category === 'charity' ? 'Kids Sports Fund Charity Cup' : category === 'corporate' ? 'Inter-Office 5-a-side League' : 'Lusaka Futsal Cup'} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Area">
              <input className={fieldCls} maxLength={80} value={area} onChange={(e) => setArea(e.target.value)} placeholder="Lusaka" />
            </Field>
            <Field label="Most teams">
              <input className={fieldCls} type="number" min={2} max={64} value={maxEntries} onChange={(e) => setMaxEntries(Number(e.target.value))} />
            </Field>
            <Field label="Starts">
              <input className={fieldCls} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </Field>
            <Field label="Ends (optional)">
              <input className={fieldCls} type="date" value={endsOn} min={startsOn || undefined} onChange={(e) => setEndsOn(e.target.value)} />
            </Field>
          </div>
          {format === 'groups_knockout' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Groups">
                <select className={fieldCls} value={groupCount} onChange={(e) => setGroupCount(Number(e.target.value))}>
                  {[2, 3, 4, 6, 8].map((n) => (
                    <option key={n} value={n}>
                      {n} groups
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Go through from each group">
                <select className={fieldCls} value={advance} onChange={(e) => setAdvance(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      Top {n}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? <EventDetailsFields value={details} onChange={setDetails} category={category} folder={`competitions/new-${profile?.id ?? 'me'}`} /> : null}

      {step === 3 ? <RegistrationFields value={registration} onChange={setRegistration} category={category} /> : null}

      {step === 4 ? (
        <Card className="overflow-hidden">
          {details.bannerUrl ? <img src={details.bannerUrl} alt="" className="h-36 w-full object-cover" /> : null}
          <div className="flex flex-col gap-2 p-4">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="brand">{CATEGORY_LABELS[category]}</Badge>
              <Badge tone="muted">{FORMAT_LABELS[format]}</Badge>
              {sport ? <Badge tone="muted">{sportLabel(sport.name)}</Badge> : null}
            </div>
            <strong className="text-[20px]">{name || 'Untitled'}</strong>
            <span className="text-[14px] text-muted">
              {[area, startsOn && new Date(startsOn).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }), `up to ${maxEntries} teams`]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {details.hostName ? <span className="text-[14px]">Hosted by {details.hostName}</span> : null}
            {details.causeName ? <span className="text-[14px]">In support of {details.causeName}</span> : null}
            <span className="text-[13px] text-muted">
              {registration.requiresApproval ? 'You approve each team.' : 'Teams are accepted automatically.'}
              {registration.questions.length ? ` ${registration.questions.length} question${registration.questions.length === 1 ? '' : 's'} for teams.` : ''}
            </span>
            <span className="text-[13px] text-muted">You can add sponsors, edit everything and post news from the Manage tab after publishing.</span>
          </div>
        </Card>
      ) : null}

      <ErrorNote>{error}</ErrorNote>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 lg:left-64">
        <div className="mx-auto flex max-w-[720px] gap-2">
          {step > 0 ? (
            <Button className="flex-1" size="lg" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <Button className="flex-[2]" size="lg" variant="primary" onClick={next}>
              Continue
            </Button>
          ) : (
            <Button className="flex-[2]" size="lg" variant="primary" disabled={busy} icon={<Trophy size={18} />} onClick={() => void publish()}>
              {busy ? 'Publishing…' : 'Publish and open entries'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
