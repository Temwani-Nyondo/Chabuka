import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Delete, Flag, Undo2, WifiOff } from 'lucide-react';
import { formatDuration } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { runAction } from '../lib/api';
import { fetchLine } from '../lib/races';
import type { LineState } from '../lib/races';
import { Button, ButtonLink, ErrorNote, cx } from '../components/ui';

// The finish line, on a volunteer's phone. A big clock since the gun, a keypad: type the bib as a runner crosses and
// tap Record (or tap "No bib" and fix it later). Several volunteers can record at once. On a bad signal, marks are
// queued on the phone with the time they were tapped and sent in order when the signal returns.

interface Queued {
  distanceId: string;
  bib: number | null;
  clientId: string;
  deviceAt: string;
}

const QUEUE_KEY = 'chabuka-finish-queue';
const readQueue = (): Queued[] => {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as Queued[];
  } catch {
    return [];
  }
};
const writeQueue = (q: Queued[]) => {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    // storage unavailable: the in-memory queue still works for this session
  }
};
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function FinishLinePage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const distanceId = params.get('distance') ?? '';
  const { session } = useAuth();
  const token = session?.access_token ?? '';
  const [state, setState] = useState<LineState | null>(null);
  const [bib, setBib] = useState('');
  const [queue, setQueue] = useState<Queued[]>(readQueue);
  const [last, setLast] = useState<{ text: string; warn: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fix, setFix] = useState<{ markId: string; bib: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const sending = useRef(false);

  const load = useCallback(async () => {
    if (!token || !distanceId) return;
    try {
      setState(await fetchLine(token, distanceId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the finish line.');
    }
  }, [token, distanceId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // Send queued marks in order; stop at the first network failure and try again shortly.
  const flush = useCallback(async () => {
    if (sending.current || !token) return;
    sending.current = true;
    try {
      let q = readQueue();
      while (q.length > 0) {
        const m = q[0]!;
        try {
          const r = await runAction<{ position?: number; runner?: string | null; time?: string | null; warning?: string | null; state: string }>('finish_mark', m, token);
          if (r.state === 'recorded') {
            setLast({
              text: r.warning ? r.warning : `${m.bib ?? 'No bib'}${r.runner ? `, ${r.runner}` : ''}: ${r.time ?? ''} (${r.position ?? ''})`,
              warn: !!r.warning,
            });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : '';
          if (/reach|network|fetch/i.test(msg)) break;
          setLast({ text: msg || 'That mark was refused.', warn: true });
        }
        q = q.slice(1);
        writeQueue(q);
        setQueue(q);
      }
    } finally {
      sending.current = false;
      void load();
    }
  }, [token, load]);

  useEffect(() => {
    void flush();
    const t = setInterval(() => void flush(), 4000);
    return () => clearInterval(t);
  }, [flush]);

  const record = (withBib: boolean) => {
    const n = withBib ? Number(bib) : null;
    if (withBib && (!Number.isInteger(n) || (n ?? 0) <= 0)) return;
    const mark: Queued = { distanceId, bib: n, clientId: newId(), deviceAt: new Date().toISOString() };
    const q = [...readQueue(), mark];
    writeQueue(q);
    setQueue(q);
    setBib('');
    if (navigator.vibrate) navigator.vibrate(30);
    void flush();
  };

  const press = (k: string) => setBib((b) => (b.length >= 6 ? b : b + k));

  if (!distanceId) {
    return <div className="p-6"><ErrorNote>Open the finish line from the race's Manage tab.</ErrorNote></div>;
  }
  const gun = state?.distance.gunStartedAt ? new Date(state.distance.gunStartedAt).getTime() : null;
  const clock = gun ? formatDuration(Math.max(0, (now - gun) / 1000)) : '--:--';

  return (
    <div className="fixed inset-0 z-[1500] flex flex-col bg-bg text-ink">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <ButtonLink to={`/races/${id}?tab=manage`} variant="ghost" size="sm" icon={<ChevronLeft size={18} />}>
          Back
        </ButtonLink>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[13px] font-bold">{state?.race.name ?? 'Finish line'}</p>
          {state && state.otherDistances.length > 1 ? (
            <select
              className="h-7 rounded-md border border-line bg-surface px-1 text-[13px]"
              value={distanceId}
              onChange={(e) => setParams((p) => { p.set('distance', e.target.value); return p; })}
              aria-label="Distance"
            >
              {state.otherDistances.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          ) : (
            <p className="m-0 text-[12px] text-muted">{state?.distance.name}</p>
          )}
        </div>
        <span className="text-right text-[12px] text-muted">
          <strong className="block text-[16px] text-ink">{state?.finished ?? 0}</strong>of {state?.starters ?? 0}
        </span>
      </header>

      <div className="flex flex-col items-center px-4 pt-3">
        <span className={cx('font-mono text-[44px] font-extrabold leading-none tabular-nums', !gun && 'text-muted')}>{clock}</span>
        {!gun ? <span className="text-[13px] text-muted">The clock starts when the organiser starts this distance.</span> : null}
        {queue.length > 0 ? (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-hl px-2.5 py-0.5 text-[12px] font-bold text-hl-text">
            <WifiOff size={13} /> {queue.length} waiting to send
          </span>
        ) : null}
        {last ? <p className={cx('m-0 mt-1 text-center text-[14px] font-semibold', last.warn ? 'text-danger' : 'text-brand-text')}>{last.text}</p> : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </div>

      <div className="flex flex-1 flex-col justify-end gap-2 px-3 pb-3">
        <div className="flex h-16 items-center justify-center rounded-2xl border-2 border-line bg-surface font-mono text-[40px] font-extrabold tabular-nums">
          {bib || <span className="text-[18px] font-semibold text-muted">Bib number</span>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
            <button key={k} type="button" onClick={() => press(k)} className="h-14 cursor-pointer rounded-2xl border border-line bg-surface text-[26px] font-bold active:bg-surface-2">
              {k}
            </button>
          ))}
          <button type="button" onClick={() => record(false)} disabled={!gun} className="h-14 cursor-pointer rounded-2xl border border-line bg-surface-2 text-[14px] font-bold disabled:opacity-40">
            No bib
          </button>
          <button type="button" onClick={() => press('0')} className="h-14 cursor-pointer rounded-2xl border border-line bg-surface text-[26px] font-bold active:bg-surface-2">
            0
          </button>
          <button type="button" onClick={() => setBib((b) => b.slice(0, -1))} aria-label="Delete digit" className="flex h-14 cursor-pointer items-center justify-center rounded-2xl border border-line bg-surface active:bg-surface-2">
            <Delete size={24} />
          </button>
        </div>
        <Button variant="primary" size="lg" block disabled={!gun || !bib} icon={<Flag size={20} />} onClick={() => record(true)} className="h-16 text-[20px]">
          Record
        </Button>

        <div className="max-h-[28vh] overflow-y-auto rounded-2xl border border-line">
          {(state?.marks ?? []).slice(0, 12).map((m) => (
            <div key={m.id} className="flex items-center gap-2 border-line px-3 py-2 text-[14px] [&+&]:border-t">
              <span className="w-8 text-muted">{m.position}</span>
              <span className="w-16 font-mono font-bold">{m.bib ?? '?'}</span>
              <span className={cx('min-w-0 flex-1 truncate', m.wrongDistance && 'text-danger')}>{m.bib == null ? 'No bib yet' : m.runner ?? 'Unknown bib'}</span>
              <span className="font-mono">{m.time}</span>
              {m.bib == null ? (
                <button type="button" className="cursor-pointer rounded-lg border border-line px-2 py-1 text-[12px] font-bold" onClick={() => setFix({ markId: m.id, bib: '' })}>
                  Add bib
                </button>
              ) : null}
              <button
                type="button"
                aria-label={`Undo ${m.bib ?? 'mark'}`}
                className="cursor-pointer border-0 bg-transparent p-1 text-muted"
                onClick={() => void runAction('void_mark', { markId: m.id }, token).then(load).catch((e: unknown) => setLast({ text: e instanceof Error ? e.message : 'Could not undo.', warn: true }))}
              >
                <Undo2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {fix ? (
        <div className="absolute inset-x-3 bottom-3 flex gap-2 rounded-2xl border border-line bg-surface p-3 shadow-lg">
          <input
            className="h-12 flex-1 rounded-xl border border-line bg-bg px-3 font-mono text-[22px]"
            inputMode="numeric"
            autoFocus
            value={fix.bib}
            onChange={(e) => setFix({ ...fix, bib: e.target.value.replace(/\D/g, '').slice(0, 6) })}
            placeholder="Bib"
            aria-label="Bib for this finish"
          />
          <Button
            variant="primary"
            disabled={!fix.bib}
            onClick={() =>
              void runAction<{ runner: string | null; warning: string | null }>('resolve_mark', { markId: fix.markId, bib: Number(fix.bib) }, token)
                .then((r) => {
                  setLast({ text: r.warning ?? `Bib ${fix.bib}${r.runner ? `, ${r.runner}` : ''} added`, warn: !!r.warning });
                  setFix(null);
                  void load();
                })
                .catch((e: unknown) => setLast({ text: e instanceof Error ? e.message : 'Could not save.', warn: true }))
            }
          >
            Save
          </Button>
          <Button onClick={() => setFix(null)}>Cancel</Button>
        </div>
      ) : null}
    </div>
  );
}
