import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Ban, Flag, Lock } from 'lucide-react';
import { LEVEL_LABELS, formatDuration } from '@chabuka/shared';
import type { Level } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { runAction } from '../lib/api';
import { fetchPlayer } from '../lib/social';
import type { PlayerView } from '../lib/social';
import { sportLabel } from '../components/GameCard';
import { RecordCard } from '../components/Records';
import { Avatar, Badge, Button, ButtonLink, Card, Crest, ErrorNote, ListRow, Section, Sheet, Skeleton, StatTile } from '../components/ui';
import { fieldCls } from '../components/CompetitionForms';

// A player's profile, as another player sees it. Name and photo always; sports, teams and record only when their
// privacy setting allows it for you (by default: teammates and people they have played with). Report and block.

export default function PlayerPage() {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const token = session?.access_token ?? '';
  const [p, setP] = useState<PlayerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    fetchPlayer(token, id)
      .then(setP)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Player not found.'));
  useEffect(() => {
    if (token) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  if (!p) return <div className="mx-auto max-w-2xl px-4 pt-4">{error ? <ErrorNote>{error}</ErrorNote> : <Skeleton className="h-48" />}</div>;
  const pbs = new Map<string, number>();
  for (const r of p.races ?? []) if (r.status === 'finished' && r.seconds != null && (!pbs.has(r.distance) || r.seconds < pbs.get(r.distance)!)) pbs.set(r.distance, r.seconds);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-24">
      <section className="overflow-hidden border-b border-line bg-surface lg:mt-4 lg:rounded-3xl lg:border">
        {p.coverUrl ? <img src={p.coverUrl} alt="" className="h-28 w-full object-cover" /> : <div className="h-16 bg-brand-soft" />}
        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="-mt-9 flex items-end justify-between gap-3">
            <Avatar name={p.name} src={p.photoUrl} size={76} className="border-4 border-surface" />
            {p.relation === 'self' ? (
              <ButtonLink to="/you/settings#privacy" size="sm">Privacy settings</ButtonLink>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" icon={<Flag size={15} />} onClick={() => setReport(true)}>Report</Button>
                <Button
                  size="sm"
                  variant={p.blockedByMe ? 'secondary' : 'danger'}
                  icon={<Ban size={15} />}
                  onClick={() =>
                    void runAction(p.blockedByMe ? 'unblock_user' : 'block_user', { userId: p.id }, token)
                      .then(() => {
                        setNotice(p.blockedByMe ? 'Unblocked.' : 'Blocked. You will not see each other in games and lists.');
                        void load();
                      })
                      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not do that.'))
                  }
                >
                  {p.blockedByMe ? 'Unblock' : 'Block'}
                </Button>
              </div>
            )}
          </div>
          <div>
            <h1 className="m-0">{p.name}</h1>
          </div>
          {p.visible && p.sports?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {p.sports.map((s) => (
                <Badge key={s.name} tone="brand">
                  {sportLabel(s.name)}
                  {s.level ? <span className="font-semibold opacity-75"> · {LEVEL_LABELS[s.level as Level] ?? s.level}</span> : null}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <div className="flex flex-col gap-5 px-4">
        {notice ? <p className="m-0 rounded-xl bg-brand-soft px-3 py-2 text-[14px] font-semibold text-brand-text">{notice}</p> : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {!p.visible ? (
          <Card className="flex items-center gap-3 p-4 text-[14px] text-muted">
            <Lock size={20} className="shrink-0" />
            {p.blockedByMe ? 'You have blocked this player.' : `${p.name.split(' ')[0]} shares their record and teams with teammates and people they have played with.`}
          </Card>
        ) : (
          <>
            {p.stats ? (
              <RecordCard data={p.stats} />
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <StatTile value={p.record?.played ?? 0} label="Games" />
                <StatTile value={p.teams?.length ?? 0} label="Teams" />
                <StatTile value={p.races?.length ?? 0} label="Races" />
              </div>
            )}
            {p.teams?.length ? (
              <Section title="Teams">
                <Card>
                  {p.teams.map((t) => (
                    <ListRow key={t.id} to={`/teams/${t.id}`} leading={<Crest id={t.id} name={t.name} src={t.logo_url} />} title={t.name} />
                  ))}
                </Card>
              </Section>
            ) : null}
            {p.record?.recent.length ? (
              <Section title="Recent games">
                <Card>
                  {p.record.recent.map((m) => (
                    <ListRow
                      key={m.id}
                      to={`/games/${m.id}`}
                      title={m.title}
                      sub={new Date(m.starts_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      trailing={m.home_score != null ? <span className="font-mono font-bold">{m.home_score}-{m.away_score}</span> : undefined}
                    />
                  ))}
                </Card>
              </Section>
            ) : null}
            {p.races?.length ? (
              <Section title="Races">
                {pbs.size ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {[...pbs.entries()].map(([d, s]) => (
                      <StatTile key={d} value={formatDuration(s)} label={`${d} best`} />
                    ))}
                  </div>
                ) : null}
                <Card>
                  {p.races.map((r, i) => (
                    <ListRow key={i} to={`/races/${r.raceId}?tab=results`} title={r.race} sub={`${r.distance} · ${r.status === 'finished' ? formatDuration(r.seconds) : r.status.toUpperCase()}${r.position ? ` · #${r.position}` : ''}`} />
                  ))}
                </Card>
              </Section>
            ) : null}
          </>
        )}
      </div>

      <Sheet open={report} onClose={() => setReport(false)} title={`Report ${p.name}`}>
        <div className="flex flex-col gap-3">
          <textarea className={`${fieldCls} h-28 py-2`} maxLength={500} placeholder="What happened?" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button
            variant="primary"
            disabled={reason.trim().length < 5}
            onClick={() =>
              void runAction('report_user', { userId: p.id, reason: reason.trim() }, token)
                .then(() => {
                  setReport(false);
                  setReason('');
                  setNotice('Report sent. Our team reviews every report.');
                })
                .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not send the report.'))
            }
          >
            Send report
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
