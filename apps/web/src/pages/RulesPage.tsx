import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Plus, ScrollText, X } from 'lucide-react';
import type { RuleItem } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { fetchRuleBook, saveRuleBook } from '../lib/teamAdmin';
import type { RuleBookView } from '../lib/teamAdmin';
import { Badge, Button, Card, ErrorNote, Skeleton, cx } from '../components/ui';

const fieldCls = 'w-full rounded-xl border border-line bg-surface px-3 text-[15px] text-ink focus-visible:outline-2 focus-visible:outline-brand';

export default function RulesPage() {
  const { type = 'match', id = '' } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const token = session?.access_token;
  const [book, setBook] = useState<RuleBookView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const kind = (['match', 'fixture', 'competition', 'team'].includes(type) ? type : 'match') as 'match' | 'fixture' | 'competition' | 'team';

  useEffect(() => {
    if (!token) return;
    fetchRuleBook(token, kind, id)
      .then((b) => {
        setBook(b);
        setTitle(b.title);
        setRules(b.rules);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load the rules.'));
  }, [token, kind, id]);

  if (!book) {
    return (
      <div className="mx-auto max-w-[720px] px-4 pt-4">{error ? <ErrorNote>{error}</ErrorNote> : <Skeleton className="h-80" />}</div>
    );
  }

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rules.length) return;
    const next = rules.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    setRules(next);
  };
  const edit = (i: number, patch: Partial<RuleItem>) => setRules(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const save = async () => {
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const clean = rules.map((r) => ({ title: r.title.trim(), body: r.body.trim() })).filter((r) => r.title);
      const { version } = await saveRuleBook(token, { target: book.target, title: title.trim(), rules: clean });
      setBook({ ...book, title: title.trim(), rules: clean, version, source: kind === 'fixture' ? 'competition' : 'own' });
      setRules(clean);
      setEditing(false);
      setNotice(`Saved as version ${version}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const sourceLabel =
    book.source === 'template' ? 'Starter rules for this sport' : book.source === 'competition' ? 'Set by the competition organiser' : `Version ${book.version}`;

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4 px-4 pb-28 pt-4">
      <header className="flex items-start gap-2">
        <button type="button" aria-label="Back" onClick={() => navigate(-1)} className="-ml-2 mt-0.5 flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-[22px] text-ink hover:bg-surface-2">
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <span className="mb-1 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
            <ScrollText size={14} /> Rule book
          </span>
          {editing ? (
            <input className={cx(fieldCls, 'h-11 text-[18px] font-bold')} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} aria-label="Rule book name" />
          ) : (
            <h1 className="m-0">{book.title}</h1>
          )}
        </div>
        <Badge tone={book.source === 'template' ? 'muted' : 'brand'}>{sourceLabel}</Badge>
      </header>

      {book.source === 'template' && !editing ? (
        <p className="m-0 text-[14px] text-muted">
          {book.canEdit ? 'These are starter rules. Edit them to make them yours; players and officials see whatever you save here.' : 'The organiser has not written their own rules yet, so these starter rules apply.'}
        </p>
      ) : null}
      {notice ? <p className="m-0 text-[13px] font-semibold text-brand-text">{notice}</p> : null}

      {editing ? (
        <div className="flex flex-col gap-3">
          {rules.map((r, i) => (
            <Card key={i} className="flex flex-col gap-2 p-3">
              <div className="flex items-center gap-2">
                <span className="tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-[13px] font-extrabold text-brand-text">{i + 1}</span>
                <input className={cx(fieldCls, 'h-10 font-bold')} value={r.title} maxLength={80} placeholder="Rule title" onChange={(e) => edit(i, { title: e.target.value })} aria-label={`Rule ${i + 1} title`} />
              </div>
              <textarea className={cx(fieldCls, 'min-h-20 py-2')} value={r.body} maxLength={600} placeholder="What the rule says" onChange={(e) => edit(i, { body: e.target.value })} aria-label={`Rule ${i + 1} details`} />
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} icon={<ArrowUp size={15} />} />
                <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === rules.length - 1} onClick={() => move(i, 1)} icon={<ArrowDown size={15} />} />
                <Button size="sm" variant="danger" aria-label="Remove rule" onClick={() => setRules(rules.filter((_, k) => k !== i))} icon={<X size={15} />} />
              </div>
            </Card>
          ))}
          <Button icon={<Plus size={16} />} disabled={rules.length >= 40} onClick={() => setRules([...rules, { title: '', body: '' }])}>
            Add a rule
          </Button>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <ol className="m-0 list-none p-0">
            {book.rules.map((r, i) => (
              <li key={i} className="flex gap-3 px-3.5 py-3 [&+&]:border-t [&+&]:border-line">
                <span className="tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-[13px] font-extrabold text-brand-text">{i + 1}</span>
                <span className="flex min-w-0 flex-col">
                  <strong>{r.title}</strong>
                  {r.body ? <span className="text-[14px] text-muted">{r.body}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <ErrorNote>{error}</ErrorNote>

      {book.canEdit ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 lg:left-64">
          <div className="mx-auto flex max-w-[720px] gap-2">
            {editing ? (
              <>
                <Button
                  className="flex-1"
                  size="lg"
                  onClick={() => {
                    setEditing(false);
                    setTitle(book.title);
                    setRules(book.rules);
                  }}
                >
                  Cancel
                </Button>
                <Button className="flex-[2]" size="lg" variant="primary" disabled={saving || !title.trim() || rules.every((r) => !r.title.trim())} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save rule book'}
                </Button>
              </>
            ) : (
              <Button className="flex-1" size="lg" variant="primary" onClick={() => setEditing(true)}>
                {book.source === 'template' ? 'Make these rules your own' : 'Edit rules'}
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
