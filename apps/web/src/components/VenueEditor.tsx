import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Venue } from '@chabuka/shared';
import { updateVenueAction } from '../lib/api';
import { uploadImage } from '../lib/upload';

interface Props {
  venue: Venue;
  token: string | undefined;
  onSaved: (message: string) => void;
}

// Owner-side editing of a venue: details, prices, hours and photos. Changing the
// name sends an approved venue back to review; the server says so.
export default function VenueEditor({ venue, token, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(venue.name);
  const [area, setArea] = useState(venue.area ?? '');
  const [sports, setSports] = useState(venue.sports.join(', '));
  const [facilities, setFacilities] = useState(venue.facility_types.join(', '));
  const [contact, setContact] = useState(venue.contact ?? '');
  const [priceNote, setPriceNote] = useState(venue.price_note ?? '');
  const [hours, setHours] = useState(venue.hours ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const uploaded: string[] = [];
        for (const f of files.slice(0, 8 - venue.photos.length)) {
          uploaded.push(await uploadImage(`venue-photos/${venue.id}`, f));
        }
        const result = (await updateVenueAction(
          {
            venueId: venue.id,
            name: name.trim(),
            area: area.trim(),
            sports: list(sports),
            facilityTypes: list(facilities),
            contact: contact.trim(),
            priceNote: priceNote.trim(),
            hours: hours.trim(),
            ...(uploaded.length > 0 ? { photos: [...venue.photos, ...uploaded] } : {}),
          },
          token,
        )) as { state?: string };
        setFiles([]);
        setOpen(false);
        onSaved(
          result.state === 'pending_review'
            ? 'Saved. A new name or location goes back to an admin for review first.'
            : 'Venue saved.',
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save the venue.');
      } finally {
        setBusy(false);
      }
    })();
  };

  const removePhoto = (url: string) => {
    if (!token) return;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        await updateVenueAction({ venueId: venue.id, photos: venue.photos.filter((p) => p !== url) }, token);
        onSaved('Photo removed.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not remove the photo.');
      } finally {
        setBusy(false);
      }
    })();
  };

  if (!open) {
    return (
      <button className="btn" type="button" onClick={() => setOpen(true)}>
        Edit venue details and photos
      </button>
    );
  }

  return (
    <form className="card" onSubmit={save}>
      <strong>Edit venue</strong>
      <label className="field">
        Name
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </label>
      <label className="field">
        Area
        <input className="input" value={area} onChange={(e) => setArea(e.target.value)} maxLength={80} />
      </label>
      <label className="field">
        Sports (comma separated)
        <input className="input" value={sports} onChange={(e) => setSports(e.target.value)} />
      </label>
      <label className="field">
        Facilities (comma separated)
        <input className="input" value={facilities} onChange={(e) => setFacilities(e.target.value)} />
      </label>
      <label className="field">
        Contact
        <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} />
      </label>
      <label className="field">
        Prices
        <input className="input" value={priceNote} onChange={(e) => setPriceNote(e.target.value)} maxLength={120} placeholder="K150 per hour" />
      </label>
      <label className="field">
        Opening hours
        <input className="input" value={hours} onChange={(e) => setHours(e.target.value)} maxLength={200} placeholder="Mon-Fri 16:00-21:00, Sat 08:00-18:00" />
      </label>
      {venue.photos.length > 0 ? (
        <div className="actions-row">
          {venue.photos.map((url) => (
            <span key={url} className="venue-photo-edit">
              <img className="circle-photo" src={url} alt="" />
              <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => removePhoto(url)}>
                Remove
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <label className="field">
        Add photos (up to {Math.max(0, 8 - venue.photos.length)} more)
        <input
          className="input"
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(e) => setFiles([...(e.target.files ?? [])])}
        />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <div className="actions-row">
        <button className="btn btn-primary" type="submit" disabled={busy || !token}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
