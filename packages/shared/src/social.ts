import { z } from 'zod';

// --- Phase 5: circles as channels, creators, following, privacy ---------------------------------
// Minimal social by design: admins post to circles, approved creators publish posts and articles, everyone else
// reacts (a small fixed set), follows and reads. No comments, no direct messages.

export const REACTIONS = ['like', 'fire', 'clap', 'strong'] as const;
export type Reaction = (typeof REACTIONS)[number];
export const REACTION_LABELS: Record<Reaction, string> = { like: 'Like', fire: 'Fire', clap: 'Clap', strong: 'Strong' };

export const CIRCLE_ROLES = ['owner', 'admin'] as const;
export type CircleRole = (typeof CIRCLE_ROLES)[number];

export const NOTIFY_LEVELS = ['all', 'important', 'none'] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];
export const NOTIFY_LABELS: Record<NotifyLevel, string> = { all: 'Every post', important: 'Important posts only', none: 'Muted' };

export const FOLLOW_SUBJECTS = ['creator', 'team', 'competition', 'venue'] as const;
export type FollowSubject = (typeof FOLLOW_SUBJECTS)[number];

export const PROFILE_VISIBILITY = ['everyone', 'connections', 'private'] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITY)[number];
export const VISIBILITY_LABELS: Record<ProfileVisibility, string> = {
  everyone: 'Everyone on Chabuka',
  connections: 'Teammates and people I have played with',
  private: 'Only me',
};

export type Relation = 'self' | 'connection' | 'other';

/** Whether a viewer sees someone's record, teams and sports. Name and photo are always visible. */
export function canSeeProfile(visibility: ProfileVisibility | null | undefined, relation: Relation, blocked = false): boolean {
  if (relation === 'self') return true;
  if (blocked) return false;
  const v = visibility ?? 'connections';
  if (v === 'everyone') return true;
  if (v === 'connections') return relation === 'connection';
  return false;
}

/** Who gets a notification for a circle post. */
export function notifiesFor(level: NotifyLevel | null | undefined, important: boolean): boolean {
  const l = level ?? 'all';
  return l === 'all' || (l === 'important' && important);
}

// --- Articles: a tiny safe format, never HTML -------------------------------------------------

export type ArticleBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; parts: InlinePart[] }
  | { type: 'quote'; text: string }
  | { type: 'image'; url: string; caption: string }
  | { type: 'list'; items: string[] };

export type InlinePart = { text: string; href?: string; bold?: boolean };

const SAFE_URL = /^https:\/\/[^\s<>"']+$/i;

/** Splits text into plain runs, **bold** runs and [label](https://link) runs. Anything else stays as text. */
export function inlineParts(text: string): InlinePart[] {
  const out: InlinePart[] = [];
  const re = /\[([^\]]{1,200})\]\((https:\/\/[^\s)]{1,500})\)|\*\*([^*]{1,500})\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] && m[2] && SAFE_URL.test(m[2])) out.push({ text: m[1], href: m[2] });
    else if (m[3]) out.push({ text: m[3], bold: true });
    else out.push({ text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text: '' }];
}

/**
 * Article body to blocks. Lines starting "## " are headings, "> " quotes, "- " list items, and a line that is only
 * ![caption](https://image) is a picture. Blank lines separate paragraphs. Everything is rendered as text by the web,
 * so tags typed into an article show up as text and never run.
 */
export function articleBlocks(body: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'paragraph', parts: inlineParts(para.join(' ').trim()) });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: 'list', items: list });
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    const img = /^!\[([^\]]{0,200})\]\((https:\/\/[^\s)]{1,500})\)$/.exec(line);
    if (!line) {
      flushPara();
      flushList();
    } else if (line.startsWith('## ')) {
      flushPara();
      flushList();
      blocks.push({ type: 'heading', text: line.slice(3).trim() });
    } else if (line.startsWith('> ')) {
      flushPara();
      flushList();
      blocks.push({ type: 'quote', text: line.slice(2).trim() });
    } else if (line.startsWith('- ')) {
      flushPara();
      list.push(line.slice(2).trim());
    } else if (img && SAFE_URL.test(img[2]!)) {
      flushPara();
      flushList();
      blocks.push({ type: 'image', url: img[2]!, caption: img[1] ?? '' });
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** Plain-text preview of a post or article body. */
export function excerpt(body: string, n = 160): string {
  const plain = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/^(## |> |- )/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > n ? `${plain.slice(0, n - 1).trimEnd()}…` : plain;
}

export function readingMinutes(body: string): number {
  return Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 200));
}

const RESERVED = new Set(['admin', 'chabuka', 'support', 'help', 'studio', 'new', 'edit', 'settings', 'official', 'staff', 'about', 'api']);
export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,24}$/, 'Use 3 to 24 letters, numbers or underscores')
  .refine((h) => !RESERVED.has(h), 'That handle is reserved');

// --- Inputs -----------------------------------------------------------------------------------

const uuid = z.string().uuid();
const httpsUrl = z.string().trim().url().max(500).refine((u) => u.startsWith('https://'), 'Links must start with https://');

export const circlePostSchema = z
  .object({
    circleId: uuid,
    body: z.string().trim().max(4000).default(''),
    images: z.array(httpsUrl).max(6).default([]),
    important: z.boolean().default(false),
    poll: z
      .object({
        options: z.array(z.string().trim().min(1).max(80)).min(2, 'A poll needs at least two options').max(6),
        closesAt: z.iso.datetime({ offset: true }).nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .refine((p) => p.body.length > 0 || p.images.length > 0 || !!p.poll, { message: 'Write something, add a photo or a poll' });
export type CirclePostInput = z.infer<typeof circlePostSchema>;

export const editCirclePostSchema = z.object({ postId: uuid, body: z.string().trim().min(1).max(4000) });
export const circlePostIdSchema = z.object({ postId: uuid });
export const pinCirclePostSchema = z.object({ postId: uuid, pinned: z.boolean() });
export const reactSchema = z.object({ postType: z.enum(['circle', 'creator']), postId: uuid, reaction: z.enum(REACTIONS) });
export const votePollSchema = z.object({ postId: uuid, option: z.number().int().min(0).max(5) });
export const circleNotifySchema = z.object({ circleId: uuid, notify: z.enum(NOTIFY_LEVELS) });
export const circleIdOnlySchema = z.object({ circleId: uuid });
export const circleMemberSchema = z.object({ circleId: uuid, userId: uuid });

export const applyCreatorSchema = z.object({
  handle: handleSchema,
  displayName: z.string().trim().min(2).max(60),
  bio: z.string().trim().max(500).default(''),
  sports: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  links: z.array(httpsUrl).max(5).default([]),
  pitch: z.string().trim().min(20, 'Tell us a little more (at least 20 characters)').max(2000),
});
export type ApplyCreatorInput = z.infer<typeof applyCreatorSchema>;

export const reviewCreatorSchema = z.object({
  userId: uuid,
  decision: z.enum(['approve', 'reject', 'suspend', 'reinstate']),
  note: z.string().trim().max(500).optional(),
});

export const updateCreatorProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(60).optional(),
  bio: z.string().trim().max(500).optional(),
  avatarUrl: httpsUrl.nullable().optional(),
  bannerUrl: httpsUrl.nullable().optional(),
  sports: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  links: z.array(httpsUrl).max(5).optional(),
});

export const creatorPostSchema = z
  .object({
    postId: uuid.optional(),
    kind: z.enum(['post', 'article']),
    title: z.string().trim().max(140).default(''),
    body: z.string().trim().max(40_000).default(''),
    coverUrl: httpsUrl.nullable().optional(),
    images: z.array(httpsUrl).max(6).default([]),
    sportId: uuid.nullable().optional(),
    publish: z.boolean().default(false),
  })
  .refine((p) => p.kind !== 'article' || p.title.length >= 3, { message: 'Give the article a title', path: ['title'] })
  .refine((p) => p.body.length > 0 || p.images.length > 0, { message: 'Write something or add a photo', path: ['body'] })
  .refine((p) => p.kind === 'article' || p.body.length <= 4000, { message: 'Posts are 4000 characters at most. Write an article instead.', path: ['body'] });
export type CreatorPostInput = z.infer<typeof creatorPostSchema>;

export const creatorPostIdSchema = z.object({ postId: uuid });
export const followSchema = z.object({ subjectType: z.enum(FOLLOW_SUBJECTS), subjectId: uuid });
export const profileVisibilitySchema = z.object({ visibility: z.enum(PROFILE_VISIBILITY) });
export const publishToCircleSchema = z.object({ competitionId: uuid, circleId: uuid.nullable() });
