import { useEffect, useState } from 'react';
import { Flag, Plus } from 'lucide-react';
import { blankCard, courseCardProblem, coursePar } from '@chabuka/shared';
import type { GolfHole } from '@chabuka/shared';
import { deleteCourse, fetchVenueCourses, saveCourse } from '../../lib/golf';
import type { CourseView } from '../../lib/golf';
import { Button, Card, ErrorNote, Section, Segmented } from '../ui';
import { Field, fieldCls } from '../CompetitionForms';

// A golf venue's course card on Setup: holes, par and stroke index (1 = hardest), which tee times, golf days and
// scorecards read. A club with more than one course or tee set adds one card each.

function CardForm({
  initial,
  venueId,
  token,
  onSaved,
  onCancel,
}: {
  initial: CourseView | null;
  venueId: string | null;
  token: string;
  onSaved: (c: CourseView) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? 'Main course');
  const [teeSet, setTeeSet] = useState(initial?.teeSet ?? '');
  const [holes, setHoles] = useState<9 | 18>(initial?.holes ?? 18);
  const [card, setCard] = useState<GolfHole[]>(initial?.card.length ? initial.card : blankCard(18));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeHoles(n: 9 | 18) {
    setHoles(n);
    setCard((c) => (c.length === n ? c : blankCard(n)));
  }
  function setHole(holeNo: number, patch: Partial<GolfHole>) {
    setCard((c) => c.map((h) => (h.holeNo === holeNo ? { ...h, ...patch } : h)));
  }

  const problem = courseCardProblem(holes, card);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveCourse(token, { ...(initial ? { courseId: initial.id } : { venueId }), name, holes, teeSet: teeSet.trim() || null, card }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the course.');
    } finally {
      setBusy(false);
    }
  }

  const num = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(v) || min)));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Course name">
          <input className={fieldCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Tee set (optional)" hint="e.g. White, Yellow, Red">
          <input className={fieldCls} value={teeSet} onChange={(e) => setTeeSet(e.target.value)} maxLength={30} />
        </Field>
      </div>
      <Segmented label="Holes" value={String(holes)} onChange={(v) => changeHoles(v === '9' ? 9 : 18)} options={[{ value: '18', label: '18 holes' }, { value: '9', label: '9 holes' }]} />
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="py-1 pr-2">Hole</th>
              <th className="py-1 pr-2">Par</th>
              <th className="py-1 pr-2">Stroke index</th>
              <th className="py-1">Yards</th>
            </tr>
          </thead>
          <tbody>
            {card.map((h) => (
              <tr key={h.holeNo} className="border-t border-line">
                <td className="py-1 pr-2 font-semibold">{h.holeNo}</td>
                <td className="py-1 pr-2">
                  <select className={`${fieldCls} h-9 w-20`} value={h.par} onChange={(e) => setHole(h.holeNo, { par: Number(e.target.value) })} aria-label={`Hole ${h.holeNo} par`}>
                    {[3, 4, 5, 6].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <input className={`${fieldCls} h-9 w-20`} type="number" min={1} max={holes} value={h.strokeIndex} onChange={(e) => setHole(h.holeNo, { strokeIndex: num(e.target.value, 1, holes) })} aria-label={`Hole ${h.holeNo} stroke index`} />
                </td>
                <td className="py-1">
                  <input className={`${fieldCls} h-9 w-24`} type="number" min={50} max={800} value={h.yards ?? ''} onChange={(e) => setHole(h.holeNo, { yards: e.target.value ? num(e.target.value, 50, 800) : null })} aria-label={`Hole ${h.holeNo} yards`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-[13px] text-muted">
        Par {coursePar(card)}. Stroke index 1 is the hardest hole: handicap strokes go there first.
      </p>
      {problem ? <p className="m-0 text-[13px] text-danger">{problem}</p> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex gap-2">
        <Button variant="primary" disabled={busy || !!problem || name.trim().length < 2} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save course card'}
        </Button>
        {onCancel ? <Button variant="ghost" onClick={onCancel}>Cancel</Button> : null}
      </div>
    </div>
  );
}

export function GolfCoursesCard({ venueId, token, canEdit }: { venueId: string; token: string; canEdit: boolean }) {
  const [courses, setCourses] = useState<CourseView[] | null>(null);
  const [editing, setEditing] = useState<CourseView | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    fetchVenueCourses(token, venueId)
      .then((c) => { if (!stop) setCourses(c); })
      .catch((e: unknown) => { if (!stop) setError(e instanceof Error ? e.message : 'Could not load the course.'); });
    return () => { stop = true; };
  }, [token, venueId]);

  const saved = (c: CourseView) => {
    setCourses((list) => [...(list ?? []).filter((x) => x.id !== c.id), c].sort((a, b) => a.name.localeCompare(b.name)));
    setEditing(null);
  };

  return (
    <Section title="Golf course">
      <Card className="flex flex-col gap-3 p-4">
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {courses === null ? null : courses.length === 0 && editing === null ? (
          <>
            <p className="m-0 text-[14px] text-muted">Add the course card (par and stroke index for each hole) so players can book tee times and you can run golf days with live scores.</p>
            {canEdit ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>Add course card</Button> : null}
          </>
        ) : null}
        {courses?.map((c) =>
          editing !== 'new' && editing?.id === c.id ? (
            <CardForm key={c.id} initial={c} venueId={venueId} token={token} onSaved={saved} onCancel={() => setEditing(null)} />
          ) : (
            <div key={c.id} className="flex items-center gap-3">
              <Flag size={18} className="text-muted" />
              <span className="flex-1">
                <strong className="block">{c.name}{c.teeSet ? ` (${c.teeSet})` : ''}</strong>
                <span className="text-[13px] text-muted">{c.holes} holes · par {c.par}</span>
              </span>
              {canEdit ? (
                <>
                  <Button size="sm" onClick={() => setEditing(c)}>Edit</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void deleteCourse(token, c.id)
                        .then(() => setCourses((list) => (list ?? []).filter((x) => x.id !== c.id)))
                        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not remove it.'))
                    }
                  >
                    Remove
                  </Button>
                </>
              ) : null}
            </div>
          ),
        )}
        {editing === 'new' ? <CardForm initial={null} venueId={venueId} token={token} onSaved={saved} onCancel={() => setEditing(null)} /> : null}
        {canEdit && courses && courses.length > 0 && editing === null ? (
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setEditing('new')}>Add another course or tee set</Button>
        ) : null}
      </Card>
    </Section>
  );
}

export { CardForm as CourseCardForm };
