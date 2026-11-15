import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, Plus, ScrollText } from 'lucide-react';
import type { Team } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { runAction } from '../lib/api';
import { fetchCompetitionView } from '../lib/competitions';
import type { CompetitionView } from '../lib/competitions';
import { fetchRuleBook } from '../lib/teamAdmin';
import type { RuleBookView } from '../lib/teamAdmin';
import { Button, ButtonLink, Card, Crest, ErrorNote, Skeleton, cx } from '../components/ui';
import { Field, fieldCls } from '../components/CompetitionForms';

const STEPS = ['Team', 'Details', 'Rules'];

export default function CompetitionRegisterPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user, session, profile } = useAuth();
  const token = session?.access_token;
  const [view, setView] = useState<CompetitionView | null>(null);
  const [rules, setRules] = useState<RuleBookView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'pending' | 'approved' | null>(null);

  const [teamId, setTeamId] = useState('');
  const [newTeam, setNewTeam] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [teamArea, setTeamArea] = useState(profile?.area ?? '');
  const [contactName, setContactName] = useState(profile?.name ?? '');
  const [contactPhone, setContactPhone] = useState('');
  const [squadSize, setSquadSize] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [accept, setAccept] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetchCompetitionView(id, user.id)
      .then((v) => {
        setView(v);
        const eligible = v.myTeams.filter((m) => (m.role === 'owner' || m.role === 'captain') && m.team.sport_id === v.competition.sport_id);
        if (eligible[0]) setTeamId(eligible[0].team.id);
        else setNewTeam(true);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load the competition.'));
    if (token) fetchRuleBook(token, 'competition', id).then(setRules).catch(() => undefined);
  }, [id, user, token]);

  if (!view) {
    return <div className="mx-auto max-w-[720px] px-4 pt-4">{error ? <ErrorNote>{error}</ErrorNote> : <Skeleton className="h-80" />}</div>;
  }
  const c = view.competition;
  const eligible: Team[] = view.myTeams.filter((m) => (m.role === 'owner' || m.role === 'captain') && m.team.sport_id === c.sport_id).map((m) => m.team);
  const closed = c.status !== 'registration' || (!!c.registration_closes_at && new Date(c.registration_closes_at).getTime() < Date.now());

  if (done) {
    return (
      <div className="mx-auto flex max-w-[520px] flex-col items-center gap-3 px-4 pt-16 text-center">
        <CheckCircle2 size={44} className="text-brand-text" />
        <h1 className="m-0">{done === 'approved' ? 'You’re in' : 'Entry sent'}</h1>
        <p className="m-0 text-[15px] text-muted">
          {done === 'approved'
            ? `Your team is entered in ${c.name}. You’ll be told when the fixtures are out.`
            : `${c.name} is reviewing entries. You’ll get a notification when the organiser decides.`}
        </p>
        <ButtonLink to={`/competitions/${c.id}`} variant="primary" className="mt-2">
          Back to the event
        </ButtonLink>
      </div>
    );
  }

  const validStep = (s: number): string | null => {
    if (s === 0) {
      if (newTeam && !teamName.trim()) return 'Name your team.';
      if (newTeam && !teamArea.trim()) return 'Add your team’s area.';
      if (!newTeam && !teamId) return 'Pick a team.';
    }
    if (s === 1) {
      if (!contactName.trim()) return 'Who should the organiser contact?';
      if (contactPhone.trim().length < 6) return 'Add a phone number the organiser can reach.';
      for (const q of c.registration_questions) if (q.required && !(answers[q.label] ?? '').trim()) return `Please answer: ${q.label}`;
      const n = squadSize ? Number(squadSize) : null;
      if (n != null && c.team_size_min && n < c.team_size_min) return `Squads need at least ${c.team_size_min} players.`;
      if (n != null && c.team_size_max && n > c.team_size_max) return `Squads can have at most ${c.team_size_max} players.`;
    }
    return null;
  };

  const next = () => {
    const p = validStep(step);
    if (p) {
      setError(p);
      return;
    }
    setError(null);
    setStep((s) => s + 1);
  };

  const submit = async () => {
    if (!token) return;
    if (!accept) {
      setError('Accept the rules to enter.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let tid = teamId;
      if (newTeam) {
        const made = await runAction<{ team: { id: string } }>(
          'create_team',
          { name: teamName.trim(), sportId: c.sport_id, area: teamArea.trim(), category: c.category === 'corporate' ? 'corporate' : 'recreational' },
          token,
        );
        tid = made.team.id;
        setTeamId(tid);
        setNewTeam(false);
      }
      const res = await runAction<{ status: 'pending' | 'approved' }>(
        'register_team',
        {
          competitionId: c.id,
          teamId: tid,
          contactName: contactName.trim(),
          contactPhone: contactPhone.trim(),
          squadSize: squadSize ? Number(squadSize) : undefined,
          answers: c.registration_questions.map((q) => ({ label: q.label, answer: (answers[q.label] ?? '').trim() })),
          note: note.trim() || undefined,
          acceptRules: true,
        },
        token,
      );
      setDone(res.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enter the team.');
    } finally {
      setBusy(false);
    }
  };

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
          <h1 className="m-0">Enter a team</h1>
          <p className="m-0 text-[13px] text-muted">
            {c.name} · Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </p>
        </div>
      </header>
      <ol className="m-0 grid list-none grid-cols-3 gap-1.5 p-0" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? 'step' : undefined}>
            <span className={cx('block h-1.5 rounded-full', i <= step ? 'bg-brand' : 'bg-surface-3')} />
          </li>
        ))}
      </ol>

      {closed ? <ErrorNote>Entries are closed for this event.</ErrorNote> : null}
      {c.entry_fee_note ? (
        <Card className="p-3.5 text-[14px]">
          <strong>Entry fee:</strong> {c.entry_fee_note}
        </Card>
      ) : null}

      {step === 0 ? (
        <div className="flex flex-col gap-3">
          {eligible.length > 0 ? (
            <Card className="overflow-hidden">
              {eligible.map((t) => {
                const on = !newTeam && teamId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setNewTeam(false);
                      setTeamId(t.id);
                    }}
                    className={cx('flex w-full cursor-pointer items-center gap-3 border-0 px-3.5 py-3 text-left [&+&]:border-t [&+&]:border-line', on ? 'bg-brand-soft' : 'bg-surface hover:bg-surface-2')}
                  >
                    <Crest id={t.id} name={t.name} src={t.logo_url} size={40} />
                    <span className="flex-1">
                      <strong className="text-ink">{t.name}</strong>
                      <span className="block text-[13px] text-muted">{t.area}</span>
                    </span>
                    <span className={cx('h-5 w-5 rounded-full border-2', on ? 'border-brand bg-brand' : 'border-line-strong')} aria-hidden="true" />
                  </button>
                );
              })}
            </Card>
          ) : (
            <p className="m-0 text-[14px] text-muted">You don’t captain a team in this sport yet. Create one here; you can invite your players afterwards.</p>
          )}
          {eligible.length > 0 && !newTeam ? (
            <Button className="self-start" icon={<Plus size={16} />} onClick={() => setNewTeam(true)}>
              Enter a new team instead
            </Button>
          ) : null}
          {newTeam ? (
            <Card className="flex flex-col gap-3 p-3.5">
              <strong className="text-[14px]">New team</strong>
              <Field label="Team name">
                <input className={fieldCls} maxLength={80} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder={c.category === 'corporate' ? 'Finance Department FC' : 'Woodlands United'} />
              </Field>
              <Field label="Area">
                <input className={fieldCls} maxLength={80} value={teamArea} onChange={(e) => setTeamArea(e.target.value)} />
              </Field>
              {eligible.length > 0 ? (
                <Button size="sm" variant="ghost" className="self-start" onClick={() => setNewTeam(false)}>
                  Use an existing team
                </Button>
              ) : null}
            </Card>
          ) : null}
        </div>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contact person">
              <input className={fieldCls} maxLength={120} value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </Field>
            <Field label="Phone" hint="Only the organiser sees this.">
              <input className={fieldCls} type="tel" maxLength={30} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="097…" />
            </Field>
          </div>
          <Field
            label="Squad size"
            hint={c.team_size_min || c.team_size_max ? `Between ${c.team_size_min ?? 1} and ${c.team_size_max ?? 'any number of'} players.` : undefined}
          >
            <input className={fieldCls} inputMode="numeric" maxLength={2} value={squadSize} onChange={(e) => setSquadSize(e.target.value.replace(/\D/g, ''))} />
          </Field>
          {c.registration_questions.map((q) => (
            <Field key={q.label} label={`${q.label}${q.required ? '' : ' (optional)'}`}>
              <input className={fieldCls} maxLength={1000} value={answers[q.label] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.label]: e.target.value })} />
            </Field>
          ))}
          <Field label="Anything else for the organiser? (optional)">
            <textarea className={cx(fieldCls, 'h-20 py-2')} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-3">
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
              <ScrollText size={18} className="text-brand-text" />
              <strong>{rules?.title ?? 'Rules'}</strong>
            </div>
            <ol className="m-0 flex max-h-80 list-none flex-col overflow-y-auto p-0">
              {(rules?.rules ?? []).map((r, i) => (
                <li key={i} className="flex gap-3 px-3.5 py-2.5 [&+&]:border-t [&+&]:border-line">
                  <span className="tnum w-5 shrink-0 text-[13px] font-extrabold text-brand-text">{i + 1}</span>
                  <span className="text-[14px]">
                    <strong>{r.title}.</strong> <span className="text-muted">{r.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
          <Link to={`/rules/competition/${c.id}`} className="text-[13px] font-semibold text-brand-text">
            Open the full rule book
          </Link>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface p-3.5">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
            <span className="text-[14px]">
              I’ve read the rules and my team will play by them. {c.entry_fee_note ? 'I understand the entry fee is arranged with the organiser.' : ''}
            </span>
          </label>
        </div>
      ) : null}

      <ErrorNote>{error}</ErrorNote>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 lg:left-64">
        <div className="mx-auto flex max-w-[720px] gap-2">
          {step > 0 ? (
            <Button className="flex-1" size="lg" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          ) : null}
          {step < 2 ? (
            <Button className="flex-[2]" size="lg" variant="primary" disabled={closed} onClick={next}>
              Continue
            </Button>
          ) : (
            <Button className="flex-[2]" size="lg" variant="primary" disabled={busy || closed || !accept} onClick={() => void submit()}>
              {busy ? 'Sending…' : c.requires_approval ? 'Send entry for approval' : 'Enter the team'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
