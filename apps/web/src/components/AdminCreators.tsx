import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { runAction } from '../lib/api';
import { fetchCreatorApplications } from '../lib/social';
import { Badge, Button, Card, Chip, EmptyState, ErrorNote } from './ui';
import { fieldCls } from './CompetitionForms';

// Admin: creator applications. Approve, reject with a reason, suspend or reinstate.

type Status = 'pending' | 'approved' | 'rejected' | 'suspended';

export default function AdminCreators({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>('pending');
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchCreatorApplications>> | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setRows(null);
    fetchCreatorApplications(token, status)
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load.'));
  }, [token, status]);
  useEffect(load, [load]);
  const decide = (userId: string, decision: 'approve' | 'reject' | 'suspend' | 'reinstate') =>
    void runAction('review_creator', { userId, decision, ...(notes[userId] ? { note: notes[userId] } : {}) }, token)
      .then(load)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not save.'));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {(['pending', 'approved', 'rejected', 'suspended'] as Status[]).map((s) => (
          <Chip key={s} on={status === s} onClick={() => setStatus(s)}>
            {s === 'pending' ? 'Waiting' : s[0]!.toUpperCase() + s.slice(1)}
          </Chip>
        ))}
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {!rows ? null : rows.length === 0 ? (
        <EmptyState title="Nothing here" body={status === 'pending' ? 'No creator applications are waiting.' : 'No creators in this list.'} />
      ) : (
        rows.map((r) => (
          <Card key={r.user_id} className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <strong className="flex-1">
                {r.display_name} <span className="font-normal text-muted">@{r.handle}</span>
              </strong>
              <Badge tone="muted">{r.account_name ?? 'Account'}</Badge>
            </div>
            {r.bio ? <p className="m-0 text-[14px]">{r.bio}</p> : null}
            {r.pitch ? <p className="m-0 whitespace-pre-line rounded-xl bg-surface-2 p-3 text-[14px]">{r.pitch}</p> : null}
            {r.sports.length ? <span className="text-[13px] text-muted">Covers: {r.sports.join(', ')}</span> : null}
            {r.links.map((l) => (
              <a key={l} href={l} target="_blank" rel="noreferrer noopener" className="text-[13px] text-brand-text">
                {l}
              </a>
            ))}
            {r.review_note ? <span className="text-[13px] text-muted">Note: {r.review_note}</span> : null}
            <input className={fieldCls} placeholder="Note to the creator (required to reject or suspend)" value={notes[r.user_id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.user_id]: e.target.value })} />
            <div className="flex flex-wrap gap-2">
              {status === 'pending' || status === 'rejected' ? <Button size="sm" variant="primary" onClick={() => decide(r.user_id, 'approve')}>Approve</Button> : null}
              {status === 'pending' ? <Button size="sm" variant="danger" onClick={() => decide(r.user_id, 'reject')}>Reject</Button> : null}
              {status === 'approved' ? (
                <>
                  <Link to={`/c/${r.handle}`} className="self-center text-[13px] font-semibold text-brand-text">View page</Link>
                  <Button size="sm" variant="danger" onClick={() => decide(r.user_id, 'suspend')}>Suspend</Button>
                </>
              ) : null}
              {status === 'suspended' ? <Button size="sm" onClick={() => decide(r.user_id, 'reinstate')}>Reinstate</Button> : null}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
