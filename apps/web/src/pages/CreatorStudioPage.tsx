import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Heading2, ImagePlus, List, PenLine, Plus, Quote, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { runAction } from '../lib/api';
import { uploadImage } from '../lib/upload';
import { fetchCreator, fetchMyCreator } from '../lib/social';
import type { CreatorPostView, CreatorView } from '../lib/social';
import { ArticleView, PhotoGrid } from '../components/Social';
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorNote, ListRow, PageHeader, Segmented, Sheet, Skeleton, StatTile, cx } from '../components/ui';
import { Field, ImageField, fieldCls } from '../components/CompetitionForms';

// Creator studio: write posts and articles (drafts, publish), edit the creator page, see followers and reactions.
// Articles use a simple text format: "## " headings, "> " quotes, "- " lists, **bold**, [links](https://...) and photos.

export default function CreatorStudioPage() {
  const { session } = useAuth();
  const token = session?.access_token ?? '';
  const [status, setStatus] = useState<Awaited<ReturnType<typeof fetchMyCreator>> | undefined>(undefined);
  const [view, setView] = useState<CreatorView | null>(null);
  const [editing, setEditing] = useState<CreatorPostView | 'post' | 'article' | null>(null);
  const [profile, setProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const s = await fetchMyCreator(token);
      setStatus(s);
      if (s) setView(await fetchCreator(token, s.handle));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the studio.');
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  if (status === undefined) return <div className="mx-auto max-w-3xl px-4 pt-4">{error ? <ErrorNote>{error}</ErrorNote> : <Skeleton className="h-64" />}</div>;
  if (!status || status.status !== 'approved') {
    return (
      <div className="mx-auto max-w-xl px-4 pt-6">
        <EmptyState
          icon={<PenLine size={22} />}
          title={status?.status === 'pending' ? 'Your application is being reviewed' : 'Creator studio is for approved creators'}
          body={status?.status === 'rejected' ? `Not approved: ${status.reviewNote ?? ''}` : 'Apply under You, Settings, Become a creator.'}
          action={<ButtonLink to="/you/settings#creator" variant="primary">Go to Settings</ButtonLink>}
        />
      </div>
    );
  }
  const posts = view?.posts ?? [];
  const reactions = posts.reduce((n, p) => n + Object.values(p.reactions).reduce((a, b) => a + b, 0), 0);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-24 pt-4">
      <PageHeader
        title="Creator studio"
        sub={<Link to={`/c/${status.handle}`} className="text-brand-text">@{status.handle}</Link>}
        actions={<Button size="sm" onClick={() => setProfile(true)}>Edit page</Button>}
      />
      <div className="grid grid-cols-3 gap-2">
        <StatTile value={view?.followers ?? 0} label="Followers" />
        <StatTile value={posts.filter((p) => p.status === 'published').length} label="Published" />
        <StatTile value={reactions} label="Reactions" />
      </div>
      <div className="flex gap-2">
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('post')}>New post</Button>
        <Button icon={<PenLine size={16} />} onClick={() => setEditing('article')}>New article</Button>
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {posts.length === 0 ? (
        <EmptyState title="Nothing yet" body="Share a training tip, a match report or local sports news." />
      ) : (
        <Card>
          {posts.map((p) => (
            <ListRow
              key={p.id}
              onClick={() => setEditing(p)}
              title={p.kind === 'article' ? p.title : p.excerpt || 'Photo post'}
              sub={`${p.kind === 'article' ? 'Article' : 'Post'} · ${p.status === 'draft' ? 'Draft' : `${Object.values(p.reactions).reduce((a, b) => a + b, 0)} reactions`}`}
              trailing={p.status === 'draft' ? <Badge tone="hl">Draft</Badge> : null}
            />
          ))}
        </Card>
      )}
      {editing ? <PostEditor token={token} initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
      {view ? <ProfileEditor open={profile} view={view} token={token} onClose={() => setProfile(false)} onSaved={() => { setProfile(false); void load(); }} /> : null}
    </div>
  );
}

function PostEditor({ token, initial, onClose, onSaved }: { token: string; initial: CreatorPostView | 'post' | 'article'; onClose: () => void; onSaved: () => void }) {
  const existing = typeof initial === 'object' ? initial : null;
  const kind = existing ? existing.kind : (initial as 'post' | 'article');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [cover, setCover] = useState<string | null>(existing?.coverUrl ?? null);
  const [images, setImages] = useState<string[]>(existing?.images ?? []);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);

  // Insert a line prefix (or an image line) at the cursor.
  const insert = (text: string) => {
    const el = area.current;
    const at = el ? el.selectionStart : body.length;
    const before = body.slice(0, at);
    const lead = before.length && !before.endsWith('\n') ? '\n' : '';
    const next = `${before}${lead}${text}${body.slice(at)}`;
    setBody(next);
    setTimeout(() => el?.focus(), 0);
  };

  const save = async (publish: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await runAction('save_creator_post', { ...(existing ? { postId: existing.id } : {}), kind, title: title.trim(), body: body.trim(), coverUrl: cover, images, publish }, token);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={existing ? `Edit ${kind}` : kind === 'article' ? 'New article' : 'New post'} wide>
      <div className="flex flex-col gap-3">
        {kind === 'article' ? (
          <>
            <input className={cx(fieldCls, 'h-12 text-[20px] font-bold')} placeholder="Title" maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
            <ImageField label="Cover image" value={cover} folder="creator-covers" wide onChange={setCover} />
            <Segmented<'write' | 'preview'> label="Editor" value={mode} onChange={setMode} options={[{ value: 'write', label: 'Write' }, { value: 'preview', label: <span className="inline-flex items-center gap-1"><Eye size={14} />Preview</span> }]} />
          </>
        ) : null}
        {mode === 'write' ? (
          <>
            {kind === 'article' ? (
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" icon={<Heading2 size={15} />} onClick={() => insert('## ')}>Heading</Button>
                <Button size="sm" icon={<Quote size={15} />} onClick={() => insert('> ')}>Quote</Button>
                <Button size="sm" icon={<List size={15} />} onClick={() => insert('- ')}>List</Button>
                <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13px] font-bold hover:bg-surface-2">
                  <ImagePlus size={15} /> Photo
                  <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadImage('creator-posts', f).then((url) => insert(`![](${url})\n`)).catch(() => setError('Upload failed.')); }} />
                </label>
              </div>
            ) : null}
            <textarea
              ref={area}
              className={cx(fieldCls, 'py-2 leading-relaxed', kind === 'article' ? 'h-80' : 'h-32')}
              placeholder={kind === 'article' ? 'Write. Leave a blank line between paragraphs.' : "What's happening?"}
              maxLength={kind === 'article' ? 40000 : 4000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label="Body"
            />
            {kind === 'post' ? (
              <>
                {images.length ? <PhotoGrid images={images} /> : null}
                <div className="flex gap-2">
                  <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13px] font-bold hover:bg-surface-2">
                    <ImagePlus size={15} /> Add photo
                    <input type="file" accept="image/*" hidden disabled={images.length >= 6} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadImage('creator-posts', f).then((url) => setImages((l) => [...l, url])).catch(() => setError('Upload failed.')); }} />
                  </label>
                  {images.length ? <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} onClick={() => setImages([])}>Remove photos</Button> : null}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <Card className="p-4">
            <ArticleView body={body || 'Nothing written yet.'} />
          </Card>
        )}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div className="flex flex-wrap gap-2">
          {existing?.status !== 'published' ? <Button disabled={busy} onClick={() => void save(false)}>Save draft</Button> : null}
          <Button variant="primary" disabled={busy} onClick={() => void save(true)}>
            {existing?.status === 'published' ? 'Save changes' : 'Publish'}
          </Button>
          {existing ? (
            <Button variant="danger" className="ml-auto" disabled={busy} onClick={() => void runAction('delete_creator_post', { postId: existing.id }, token).then(onSaved)}>
              Delete
            </Button>
          ) : null}
        </div>
        {existing?.status !== 'published' ? <p className="m-0 text-[12px] text-muted">Publishing tells your followers once.</p> : null}
      </div>
    </Sheet>
  );
}

function ProfileEditor({ open, view, token, onClose, onSaved }: { open: boolean; view: CreatorView; token: string; onClose: () => void; onSaved: () => void }) {
  const c = view.creator;
  const [name, setName] = useState(c.displayName);
  const [bio, setBio] = useState(c.bio);
  const [avatar, setAvatar] = useState<string | null>(c.avatarUrl);
  const [banner, setBanner] = useState<string | null>(c.bannerUrl);
  const [sports, setSports] = useState(c.sports.join(', '));
  const [links, setLinks] = useState(c.links.join('\n'));
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title="Edit your creator page">
      <div className="flex flex-col gap-3.5">
        <Field label="Display name">
          <input className={fieldCls} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Bio">
          <textarea className={`${fieldCls} h-24 py-2`} value={bio} maxLength={500} onChange={(e) => setBio(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <ImageField label="Photo" value={avatar} folder="creator-avatars" onChange={setAvatar} />
          <ImageField label="Banner" value={banner} folder="creator-banners" wide onChange={setBanner} />
        </div>
        <Field label="Sports" hint="Separate with commas">
          <input className={fieldCls} value={sports} onChange={(e) => setSports(e.target.value)} />
        </Field>
        <Field label="Links" hint="One https:// link per line, up to 5">
          <textarea className={`${fieldCls} h-20 py-2`} value={links} onChange={(e) => setLinks(e.target.value)} />
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Button
          variant="primary"
          onClick={() =>
            void runAction(
              'update_creator_profile',
              {
                displayName: name.trim(),
                bio: bio.trim(),
                avatarUrl: avatar,
                bannerUrl: banner,
                sports: sports.split(',').map((s) => s.trim()).filter(Boolean),
                links: links.split('\n').map((s) => s.trim()).filter(Boolean),
              },
              token,
            )
              .then(onSaved)
              .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not save.'))
          }
        >
          Save
        </Button>
      </div>
    </Sheet>
  );
}
