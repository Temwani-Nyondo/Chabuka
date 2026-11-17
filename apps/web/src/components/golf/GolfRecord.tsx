import { useCallback, useEffect, useState } from 'react';
import { Flag, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { deleteRound, fetchMyGolf, fetchPickableCourses, logRound } from '../../lib/golf';
import type { CourseView, MyGolf } from '../../lib/golf';
import { Button, ButtonLink, Card, ErrorNote, ListRow, Section, Segmented, Sheet, StatTile } from '../ui';
import { Field, fieldCls } from '../CompetitionForms';

// You → Golf: best scores, recent rounds (logged by hand or from golf days), and "Log a round". Shown once someone has
// golf in their life on Chabuka: a round, a golf day or a tee time, or golf among their sports.

const day = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function LogRoundSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { session } = useAuth();
  const token = session?.access_token ?? '';
  const [courses, setCourses] = useState<CourseView[] | null>(null);
  const [courseId, setCourseId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hcp, setHcp] = useState('');
  const [mode, setMode] = useState<'holes' | 'total'>('holes');
  const [holes, setHoles] = useState<Record<string, string>>({});
  const [total, setTotal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !token || courses) return;
    fetchPickableCourses(token).then(setCourses).catch(() => setCourses([]));
  }, [open, token, courses]);

  const course = courses?.find((c) => c.id === courseId) ?? null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const scores = mode === 'holes' ? Object.fromEntries(Object.entries(holes).filter(([, v]) => v.trim()).map(([k, v]) => [k, Number(v)])) : {};
      await logRound(token, {
        courseId,
        playedOn: date,
        handicapIndex: hcp.trim() ? Number(hcp) : null,
        ...(mode === 'holes' ? { scores } : { total: Number(total) }),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the round.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Log a round">
      <div className="flex flex-col gap-3">
        <Field label="Course">
          <select className={fieldCls} value={courseId} onChange={(e) => { setCourseId(e.target.value); setHoles({}); }}>
            <option value="">Choose a course</option>
            {(courses ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.venueName ? `${c.venueName}: ` : ''}{c.name} · {c.holes} holes</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input className={fieldCls} type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Handicap index (optional)" hint="For net and Stableford">
            <input className={fieldCls} inputMode="decimal" value={hcp} onChange={(e) => setHcp(e.target.value)} placeholder="18.4" />
          </Field>
        </div>
        <Segmented label="Scores" value={mode} onChange={setMode} options={[{ value: 'holes', label: 'Hole by hole' }, { value: 'total', label: 'Just the total' }]} />
        {mode === 'total' ? (
          <Field label="Total strokes">
            <input className={fieldCls} inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="88" />
          </Field>
        ) : course ? (
          <div className="grid grid-cols-6 gap-2">
            {course.card.map((h) => (
              <label key={h.holeNo} className="flex flex-col items-center gap-1 text-[12px] text-muted">
                {h.holeNo} <span>par {h.par}</span>
                <input
                  className={`${fieldCls} h-10 w-full text-center`}
                  inputMode="numeric"
                  value={holes[String(h.holeNo)] ?? ''}
                  onChange={(e) => setHoles({ ...holes, [String(h.holeNo)]: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                  aria-label={`Hole ${h.holeNo}`}
                />
              </label>
            ))}
          </div>
        ) : (
          <p className="m-0 text-[14px] text-muted">Pick the course to fill in each hole.</p>
        )}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Button variant="primary" block disabled={busy || !courseId || (mode === 'total' ? !total.trim() : !course)} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save round'}
        </Button>
      </div>
    </Sheet>
  );
}

export function GolfRecord({ always = false }: { always?: boolean }) {
  const { session } = useAuth();
  const token = session?.access_token ?? '';
  const [golf, setGolf] = useState<MyGolf | null>(null);
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    fetchMyGolf(token).then(setGolf).catch(() => setGolf(null));
  }, [token]);
  useEffect(load, [load]);

  if (!golf) return null;
  const any = golf.record.rounds > 0 || golf.golfDays.length > 0 || golf.teeTimes.length > 0;
  if (!any && !always) return null;
  const r = golf.record;

  return (
    <Section title="Golf" action={<Button size="sm" icon={<Plus size={14} />} onClick={() => setLogging(true)}>Log a round</Button>}>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {r.rounds > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Rounds" value={String(r.rounds)} />
          <StatTile label="Best gross" value={r.bestGross != null ? String(r.bestGross) : '-'} />
          <StatTile label="Best net" value={r.bestNet != null ? String(r.bestNet) : '-'} />
          <StatTile label="Best Stableford" value={r.bestPoints != null ? String(r.bestPoints) : '-'} />
        </div>
      ) : (
        <Card className="p-4 text-[14px] text-muted">Log your rounds to keep your best scores here. Golf days you play are added when their results are published.</Card>
      )}
      {golf.golfDays.length ? (
        <Card>
          {golf.golfDays.map((g) => (
            <ListRow key={g.id} to={`/golf/${g.id}`} leading={<Flag size={18} className="text-muted" />} title={g.name} sub={g.firstTeeAt ? new Date(g.firstTeeAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Golf day'} chevron />
          ))}
        </Card>
      ) : null}
      {golf.rounds.length ? (
        <Card>
          {golf.rounds.slice(0, 8).map((x) => (
            <ListRow
              key={x.id}
              title={`${x.courseName} · ${x.gross ?? '-'}${x.points != null ? ` · ${x.points} pts` : ''}`}
              sub={`${day(x.playedOn)} · ${x.holes} holes${x.net != null ? ` · net ${x.net}` : ''}${x.source === 'golf_day' ? ' · golf day' : ''}`}
              trailing={
                x.source === 'casual' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove round"
                    icon={<Trash2 size={14} />}
                    onClick={() => void deleteRound(token, x.id).then(load).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not remove it.'))}
                  >
                    {''}
                  </Button>
                ) : null
              }
              chevron={false}
            />
          ))}
        </Card>
      ) : null}
      {golf.record.rounds === 0 && golf.golfDays.length === 0 ? <ButtonLink to="/explore" size="sm" variant="ghost">Find a golf day or tee time</ButtonLink> : null}
      <LogRoundSheet open={logging} onClose={() => setLogging(false)} onSaved={load} />
    </Section>
  );
}
