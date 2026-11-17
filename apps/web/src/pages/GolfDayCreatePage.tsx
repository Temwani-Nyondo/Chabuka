import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COMPETITION_CATEGORIES, venueInstant } from '@chabuka/shared';
import type { CompetitionCategory } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { fetchPickableCourses, golfPost } from '../lib/golf';
import type { CourseView } from '../lib/golf';
import { CourseCardForm } from '../components/golf/CourseEditor';
import { Button, Card, ErrorNote, PageHeader, Section, Segmented, Sheet } from '../components/ui';
import { Field, fieldCls } from '../components/CompetitionForms';

// Organise a golf day: the course (one on Chabuka, or enter the card for one that isn't), the format, the start and
// the entry fee. Players enter with their handicap index; the organiser groups them into flights later.

export default function GolfDayCreatePage() {
  const { session } = useAuth();
  const token = session?.access_token ?? '';
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseView[] | null>(null);
  const [newCourse, setNewCourse] = useState(false);
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [category, setCategory] = useState<CompetitionCategory>('community');
  const [courseId, setCourseId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('07:00');
  const [scoring, setScoring] = useState<'stableford' | 'stroke'>('stableford');
  const [allowance, setAllowance] = useState(100);
  const [startType, setStartType] = useState<'tee_times' | 'shotgun'>('tee_times');
  const [interval, setIntervalMin] = useState(10);
  const [fee, setFee] = useState('');
  const [field, setField] = useState(72);
  const [maxHcp, setMaxHcp] = useState(54);
  const [longestDrive, setLongestDrive] = useState('');
  const [nearestPin, setNearestPin] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchPickableCourses(token).then(setCourses).catch(() => setCourses([]));
  }, [token]);

  const course = courses?.find((c) => c.id === courseId) ?? null;
  const holeOptions = course ? course.card.map((h) => h.holeNo) : [];
  const par3s = course ? course.card.filter((h) => h.par === 3).map((h) => h.holeNo) : [];

  async function create() {
    setBusy(true);
    setError(null);
    try {
      if (!courseId) throw new Error('Pick the course.');
      if (!date) throw new Error('Pick the date.');
      const firstTeeAt = venueInstant(date, time).toISOString();
      const sideContests = [
        ...(longestDrive ? [{ type: 'longest_drive', hole: Number(longestDrive) }] : []),
        ...(nearestPin ? [{ type: 'nearest_pin', hole: Number(nearestPin) }] : []),
      ];
      const r = await golfPost<{ competitionId: string }>(
        token,
        '',
        {
          name: name.trim(),
          area: area.trim(),
          category,
          ...(description.trim() ? { description: description.trim() } : {}),
          settings: {
            courseId,
            scoring,
            allowancePct: allowance,
            startType,
            firstTeeAt,
            intervalMin: interval,
            entryFee: fee.trim() ? Number(fee) : 0,
            currency: 'ZMW',
            fieldLimit: field,
            maxHandicap: maxHcp,
            sideContests,
          },
        },
        'Could not create the golf day.',
      );
      navigate(`/golf/${r.competitionId}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the golf day.');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-24 pt-4">
      <PageHeader title="Organise a golf day" back="/competitions" />
      <Section title="The day">
        <Card className="flex flex-col gap-3 p-4">
          <Field label="Name">
            <input className={fieldCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Charity Golf Day 2026" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Area">
              <input className={fieldCls} value={area} maxLength={80} onChange={(e) => setArea(e.target.value)} placeholder="Lusaka" />
            </Field>
            <Field label="Kind of event">
              <select className={fieldCls} value={category} onChange={(e) => setCategory(e.target.value as CompetitionCategory)}>
                {COMPETITION_CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </Field>
          </div>
          <Field label="About (optional)">
            <textarea className={`${fieldCls} min-h-24`} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </Card>
      </Section>

      <Section title="Course">
        <Card className="flex flex-col gap-3 p-4">
          {courses === null ? null : courses.length === 0 ? (
            <p className="m-0 text-[14px] text-muted">No golf courses on Chabuka yet. Enter the course card for yours.</p>
          ) : (
            <Field label="Course">
              <select className={fieldCls} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                <option value="">Choose a course</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.venueName ? `${c.venueName}: ` : ''}{c.name}{c.teeSet ? ` (${c.teeSet})` : ''} · {c.holes} holes, par {c.par}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Button size="sm" variant="ghost" onClick={() => setNewCourse(true)}>Course not listed? Enter its card</Button>
        </Card>
      </Section>

      <Section title="Format and start">
        <Card className="flex flex-col gap-3 p-4">
          <Segmented
            label="Scoring"
            value={scoring}
            onChange={(v) => { setScoring(v); setAllowance(v === 'stroke' ? 95 : 100); }}
            options={[{ value: 'stableford', label: 'Stableford' }, { value: 'stroke', label: 'Stroke play' }]}
          />
          <Field label="Handicap allowance (%)" hint="95% is usual for individual stroke play, 100% for Stableford">
            <input className={fieldCls} type="number" min={0} max={100} value={allowance} onChange={(e) => setAllowance(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date">
              <input className={fieldCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label={startType === 'shotgun' ? 'Shotgun start' : 'First tee time'}>
              <input className={fieldCls} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>
          <Segmented
            label="Start"
            value={startType}
            onChange={setStartType}
            options={[{ value: 'tee_times', label: 'Tee times' }, { value: 'shotgun', label: 'Shotgun (all at once)' }]}
          />
          {startType === 'tee_times' ? (
            <Field label="Minutes between groups">
              <input className={fieldCls} type="number" min={6} max={20} value={interval} onChange={(e) => setIntervalMin(Math.max(6, Math.min(20, Number(e.target.value) || 10)))} />
            </Field>
          ) : null}
        </Card>
      </Section>

      <Section title="Entries">
        <Card className="flex flex-col gap-3 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Entry fee (K)" hint="Empty = free. Paid entry is on WaitApp.">
              <input className={fieldCls} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Field limit">
              <input className={fieldCls} type="number" min={2} max={288} value={field} onChange={(e) => setField(Math.max(2, Math.min(288, Number(e.target.value) || 2)))} />
            </Field>
            <Field label="Max handicap">
              <input className={fieldCls} type="number" min={0} max={54} value={maxHcp} onChange={(e) => setMaxHcp(Math.max(0, Math.min(54, Number(e.target.value) || 0)))} />
            </Field>
          </div>
        </Card>
      </Section>

      {course ? (
        <Section title="Side contests (optional)">
          <Card className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label="Longest drive">
              <select className={fieldCls} value={longestDrive} onChange={(e) => setLongestDrive(e.target.value)}>
                <option value="">None</option>
                {holeOptions.map((h) => <option key={h} value={h}>Hole {h}</option>)}
              </select>
            </Field>
            <Field label="Nearest the pin" hint={par3s.length ? `Par 3s: ${par3s.join(', ')}` : undefined}>
              <select className={fieldCls} value={nearestPin} onChange={(e) => setNearestPin(e.target.value)}>
                <option value="">None</option>
                {(par3s.length ? par3s : holeOptions).map((h) => <option key={h} value={h}>Hole {h}</option>)}
              </select>
            </Field>
          </Card>
        </Section>
      ) : null}

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <Button variant="primary" block disabled={busy || !name.trim() || !area.trim() || !courseId || !date} onClick={() => void create()}>
        {busy ? 'Creating…' : 'Create golf day'}
      </Button>

      <Sheet open={newCourse} onClose={() => setNewCourse(false)} title="Enter a course" wide>
        {newCourse ? (
          <CourseCardForm
            initial={null}
            venueId={null}
            token={token}
            onSaved={(c) => {
              setCourses((list) => [...(list ?? []), c]);
              setCourseId(c.id);
              setNewCourse(false);
            }}
            onCancel={() => setNewCourse(false)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}
