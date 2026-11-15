import { useState } from 'react';
import type { ReactNode } from 'react';
import { ImagePlus, Plus, X } from 'lucide-react';
import { SPONSOR_TIERS, SPONSOR_TIER_LABELS } from '@chabuka/shared';
import type { CompetitionCategory, RegistrationQuestion, SponsorTier } from '@chabuka/shared';
import { useAuth } from '../auth/AuthContext';
import { runAction } from '../lib/api';
import { uploadImage } from '../lib/upload';
import type { Sponsor } from '../lib/competitions';
import { Button, Card, ErrorNote, Segmented, cx } from './ui';

export const fieldCls = 'h-11 w-full rounded-xl border border-line bg-surface px-3 text-[15px] text-ink focus-visible:outline-2 focus-visible:outline-brand';
export const labelCls = 'flex flex-col gap-1.5 text-[13px] font-semibold';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className={labelCls}>
      {label}
      {children}
      {hint ? <span className="font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

// Upload a picture and hand back its public URL. Shows the current picture.
export function ImageField({ label, value, folder, onChange, wide }: { label: string; value: string | null; folder: string; onChange: (url: string | null) => void; wide?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={labelCls}>
      {label}
      <div className="flex items-center gap-3">
        {value ? (
          <img src={value} alt="" className={cx('shrink-0 rounded-xl border border-line object-cover', wide ? 'h-16 w-28' : 'h-14 w-14')} />
        ) : (
          <span className={cx('flex shrink-0 items-center justify-center rounded-xl border border-dashed border-line-strong text-muted', wide ? 'h-16 w-28' : 'h-14 w-14')}>
            <ImagePlus size={20} />
          </span>
        )}
        <label className="inline-flex h-9 cursor-pointer items-center rounded-[10px] border border-line px-3 text-[13px] font-bold hover:bg-surface-2">
          {busy ? 'Uploading…' : value ? 'Change' : 'Upload'}
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setBusy(true);
              setError(null);
              uploadImage(folder, f)
                .then(onChange)
                .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Upload failed.'))
                .finally(() => setBusy(false));
            }}
          />
        </label>
        {value ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove
          </Button>
        ) : null}
      </div>
      {error ? <span className="font-normal text-danger">{error}</span> : null}
    </div>
  );
}

export interface EventDetails {
  description: string;
  bannerUrl: string | null;
  location: string;
  hostName: string;
  hostLogoUrl: string | null;
  hostContact: string;
  hostWebsite: string;
  causeName: string;
  causeDescription: string;
  causeUrl: string;
  fundraisingNote: string;
  entryFeeNote: string;
}

export const emptyDetails: EventDetails = {
  description: '',
  bannerUrl: null,
  location: '',
  hostName: '',
  hostLogoUrl: null,
  hostContact: '',
  hostWebsite: '',
  causeName: '',
  causeDescription: '',
  causeUrl: '',
  fundraisingNote: '',
  entryFeeNote: '',
};

// Everything that makes it an event: story, banner, host, cause, fee note.
export function EventDetailsFields({ value, onChange, category, folder }: { value: EventDetails; onChange: (v: EventDetails) => void; category: CompetitionCategory; folder: string }) {
  const set = (patch: Partial<EventDetails>) => onChange({ ...value, ...patch });
  const showCause = category === 'charity' || !!value.causeName;
  return (
    <div className="flex flex-col gap-4">
      <Field label="About the event" hint="What it is, who it's for, what the day looks like.">
        <textarea className={cx(fieldCls, 'h-32 py-2')} maxLength={4000} value={value.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <ImageField label="Banner" wide value={value.bannerUrl} folder={`${folder}/banner`} onChange={(bannerUrl) => set({ bannerUrl })} />
      <Field label="Where" hint="Venue, address or area. You can link a listed venue later.">
        <input className={fieldCls} maxLength={160} value={value.location} onChange={(e) => set({ location: e.target.value })} placeholder="Olympic Youth Development Centre, Lusaka" />
      </Field>

      <Card className="flex flex-col gap-3 p-3.5">
        <strong className="text-[14px]">{category === 'corporate' ? 'Hosting company' : 'Host'}</strong>
        <Field label="Host name">
          <input className={fieldCls} maxLength={120} value={value.hostName} onChange={(e) => set({ hostName: e.target.value })} placeholder={category === 'corporate' ? 'Zambeef Plc HR' : 'Lusaka Rotary Club'} />
        </Field>
        <ImageField label="Host logo" value={value.hostLogoUrl} folder={`${folder}/host`} onChange={(hostLogoUrl) => set({ hostLogoUrl })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact">
            <input className={fieldCls} maxLength={160} value={value.hostContact} onChange={(e) => set({ hostContact: e.target.value })} placeholder="events@example.com or 097…" />
          </Field>
          <Field label="Website">
            <input className={fieldCls} maxLength={2000} value={value.hostWebsite} onChange={(e) => set({ hostWebsite: e.target.value })} placeholder="https://" />
          </Field>
        </div>
      </Card>

      {showCause ? (
        <Card className="flex flex-col gap-3 p-3.5">
          <strong className="text-[14px]">The cause</strong>
          <Field label="Who it supports">
            <input className={fieldCls} maxLength={120} value={value.causeName} onChange={(e) => set({ causeName: e.target.value })} placeholder="Kids Sports Fund" />
          </Field>
          <Field label="About the cause">
            <textarea className={cx(fieldCls, 'h-24 py-2')} maxLength={2000} value={value.causeDescription} onChange={(e) => set({ causeDescription: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fundraising goal or note" hint="Shown on the page. Chabuka does not collect donations.">
              <input className={fieldCls} maxLength={300} value={value.fundraisingNote} onChange={(e) => set({ fundraisingNote: e.target.value })} placeholder="Raising K20,000 for school kits" />
            </Field>
            <Field label="Cause website">
              <input className={fieldCls} maxLength={2000} value={value.causeUrl} onChange={(e) => set({ causeUrl: e.target.value })} placeholder="https://" />
            </Field>
          </div>
        </Card>
      ) : null}

      <Field label="Entry fee (optional)" hint="Shown to teams. Collect it your way for now; Chabuka does not take payments for entries yet.">
        <input className={fieldCls} maxLength={160} value={value.entryFeeNote} onChange={(e) => set({ entryFeeNote: e.target.value })} placeholder="K500 per team, paid on the day" />
      </Field>
    </div>
  );
}

export interface RegistrationSettings {
  requiresApproval: boolean;
  closesAt: string; // datetime-local
  teamSizeMin: string;
  teamSizeMax: string;
  questions: RegistrationQuestion[];
}

export function RegistrationFields({ value, onChange, category }: { value: RegistrationSettings; onChange: (v: RegistrationSettings) => void; category: CompetitionCategory }) {
  const set = (patch: Partial<RegistrationSettings>) => onChange({ ...value, ...patch });
  const suggestions =
    category === 'corporate'
      ? ['Company or department', 'Invoice to (company name)', 'T-shirt sizes']
      : category === 'charity'
        ? ['How much will your team raise?', 'Company or group you represent']
        : category === 'school'
          ? ['School name', 'Age group']
          : ['Kit colours'];
  return (
    <div className="flex flex-col gap-4">
      <div className={labelCls}>
        Entries
        <Segmented<'approve' | 'auto'>
          label="Entry approval"
          value={value.requiresApproval ? 'approve' : 'auto'}
          onChange={(v) => set({ requiresApproval: v === 'approve' })}
          options={[
            { value: 'approve', label: 'I approve each team' },
            { value: 'auto', label: 'Accept automatically' },
          ]}
        />
      </div>
      <Field label="Registration closes (optional)">
        <input className={fieldCls} type="datetime-local" value={value.closesAt} onChange={(e) => set({ closesAt: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Smallest squad">
          <input className={fieldCls} inputMode="numeric" value={value.teamSizeMin} maxLength={2} onChange={(e) => set({ teamSizeMin: e.target.value.replace(/\D/g, '') })} placeholder="5" />
        </Field>
        <Field label="Largest squad">
          <input className={fieldCls} inputMode="numeric" value={value.teamSizeMax} maxLength={2} onChange={(e) => set({ teamSizeMax: e.target.value.replace(/\D/g, '') })} placeholder="10" />
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">Questions for teams</span>
        {value.questions.map((q, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className={fieldCls}
              maxLength={120}
              value={q.label}
              placeholder="Question"
              aria-label={`Question ${i + 1}`}
              onChange={(e) => set({ questions: value.questions.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })}
            />
            <label className="flex shrink-0 items-center gap-1.5 text-[13px]">
              <input type="checkbox" checked={q.required} onChange={(e) => set({ questions: value.questions.map((x, k) => (k === i ? { ...x, required: e.target.checked } : x)) })} />
              Required
            </label>
            <Button size="sm" variant="ghost" aria-label="Remove question" icon={<X size={15} />} onClick={() => set({ questions: value.questions.filter((_, k) => k !== i) })} />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {suggestions
            .filter((sug) => !value.questions.some((q) => q.label === sug))
            .map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => set({ questions: [...value.questions, { label: sug, required: true }] })}
                className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border border-dashed border-line-strong bg-transparent px-3 text-[12px] font-semibold text-ink hover:bg-surface-2"
              >
                <Plus size={13} /> {sug}
              </button>
            ))}
          {value.questions.length < 12 ? (
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => set({ questions: [...value.questions, { label: '', required: false }] })}>
              Your own question
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Sponsors on a saved competition: add, edit tier, remove. Each change saves.
export function SponsorManager({ competitionId, sponsors, onChanged }: { competitionId: string; sponsors: Sponsor[]; onChanged: () => void }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const [name, setName] = useState('');
  const [tier, setTier] = useState<SponsorTier>('partner');
  const [url, setUrl] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: (t: string) => Promise<unknown>) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await fn(token);
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {sponsors.length > 0 ? (
        <Card className="overflow-hidden">
          {sponsors.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 [&+&]:border-t [&+&]:border-line">
              {s.logo_url ? <img src={s.logo_url} alt="" className="h-9 w-9 rounded-lg object-contain" /> : <span className="h-9 w-9 rounded-lg bg-surface-2" />}
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[14px]">{s.name}</strong>
                <span className="text-[12px] text-muted">{SPONSOR_TIER_LABELS[s.tier]}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${s.name}`}
                disabled={busy}
                icon={<X size={15} />}
                onClick={() => void run((t) => runAction('remove_sponsor', { competitionId, sponsorId: s.id }, t))}
              />
            </div>
          ))}
        </Card>
      ) : null}
      <Card className="flex flex-col gap-3 p-3.5">
        <strong className="text-[14px]">Add a sponsor</strong>
        <Field label="Name">
          <input className={fieldCls} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Zambeef" />
        </Field>
        <div className={labelCls}>
          Level
          <select className={fieldCls} value={tier} onChange={(e) => setTier(e.target.value as SponsorTier)}>
            {SPONSOR_TIERS.map((t) => (
              <option key={t} value={t}>
                {SPONSOR_TIER_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <ImageField label="Logo" value={logo} folder={`competitions/${competitionId}/sponsors`} onChange={setLogo} />
        <Field label="Website (optional)">
          <input className={fieldCls} maxLength={2000} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <Button
          variant="primary"
          className="self-start"
          disabled={busy || !name.trim()}
          onClick={() =>
            void run((t) => runAction('upsert_sponsor', { competitionId, name: name.trim(), tier, url: url.trim() || null, logoUrl: logo }, t)).then((ok) => {
              if (ok) {
                setName('');
                setUrl('');
                setLogo(null);
              }
            })
          }
        >
          Add sponsor
        </Button>
      </Card>
    </div>
  );
}

// The details form state to the API's field names (blank strings become null).
export function detailsToInput(d: EventDetails): Record<string, unknown> {
  const blank = (s: string) => (s.trim() ? s.trim() : null);
  return {
    description: d.description.trim(),
    bannerUrl: d.bannerUrl,
    location: d.location.trim(),
    hostName: d.hostName.trim(),
    hostLogoUrl: d.hostLogoUrl,
    hostContact: d.hostContact.trim(),
    hostWebsite: blank(d.hostWebsite),
    causeName: d.causeName.trim(),
    causeDescription: d.causeDescription.trim(),
    causeUrl: blank(d.causeUrl),
    fundraisingNote: d.fundraisingNote.trim(),
    entryFeeNote: d.entryFeeNote.trim(),
  };
}

export function registrationToInput(r: RegistrationSettings): Record<string, unknown> {
  const num = (s: string) => (s.trim() ? Number(s) : null);
  return {
    requiresApproval: r.requiresApproval,
    registrationClosesAt: r.closesAt ? new Date(r.closesAt).toISOString() : null,
    teamSizeMin: num(r.teamSizeMin),
    teamSizeMax: num(r.teamSizeMax),
    registrationQuestions: r.questions.filter((q) => q.label.trim()).map((q) => ({ label: q.label.trim(), required: q.required })),
  };
}
