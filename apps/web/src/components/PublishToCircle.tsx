import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { runAction } from '../lib/api';
import { fetchCircleList } from '../lib/social';
import type { CircleSummary } from '../lib/social';
import { Button, Card, ErrorNote } from './ui';
import { fieldCls } from './CompetitionForms';

// An organiser posts their event in a circle they run: the circle gets a post with the event card ("entries are open"),
// the event shows on the circle page, and results news goes there too. Only circles where they are an owner or admin are
// offered; the server checks that again.
export default function PublishToCircle({
  competitionId,
  circleId,
  token,
  onChanged,
}: {
  competitionId: string;
  circleId: string | null | undefined;
  token: string;
  onChanged: () => void;
}) {
  const [circles, setCircles] = useState<CircleSummary[] | null>(null);
  const [choice, setChoice] = useState<string>(circleId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    fetchCircleList(token)
      .then((r) => { if (!stop) setCircles(r.yours.filter((c) => c.role === 'owner' || c.role === 'admin')); })
      .catch(() => { if (!stop) setCircles([]); });
    return () => { stop = true; };
  }, [token]);

  useEffect(() => setChoice(circleId ?? ''), [circleId]);

  async function save(next: string | null) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await runAction('publish_to_circle', { competitionId, circleId: next }, token);
      setNote(next ? 'Posted in the circle.' : 'Removed from the circle.');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change that.');
    } finally {
      setBusy(false);
    }
  }

  const current = circles?.find((c) => c.circle.id === circleId) ?? null;

  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <div className="flex items-center gap-2">
        <Radio size={18} className="text-muted" />
        <strong className="flex-1">{circleId ? `In ${current?.circle.name ?? 'a circle'}` : 'Not in a circle'}</strong>
      </div>
      <p className="m-0 text-[14px] text-muted">
        Post the event in a circle you run. Members see it on the circle page, and results news goes there too.
      </p>
      {circles === null ? null : circles.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">You don&apos;t run a circle yet. Create one under Circles to post events there.</p>
      ) : (
        <>
          <select className={fieldCls} value={choice} onChange={(e) => setChoice(e.target.value)} disabled={busy} aria-label="Circle">
            <option value="">Choose a circle</option>
            {circles.map((c) => (
              <option key={c.circle.id} value={c.circle.id}>{c.circle.name}</option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy || !choice || choice === circleId} onClick={() => void save(choice)}>
              {circleId ? 'Move to this circle' : 'Post in circle'}
            </Button>
            {circleId ? (
              <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>Remove from circle</Button>
            ) : null}
          </div>
        </>
      )}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {note ? <p className="m-0 text-[13px] text-muted">{note}</p> : null}
    </Card>
  );
}
