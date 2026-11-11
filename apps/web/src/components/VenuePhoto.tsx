import { useState } from 'react';

// Venue imagery: uploaded photos render when present, otherwise a styled
// initial banner so cards never look empty — and a broken remote image
// falls back to the banner instead of a broken-image icon.
export default function VenuePhoto({
  photos,
  name,
  banner,
}: {
  photos: string[];
  name: string;
  banner?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = (photos ?? [])[0];
  if (!src || failed) {
    return (
      <div className={banner ? 'venue-photo-fallback venue-photo-banner' : 'venue-photo-fallback'} aria-hidden="true">
        <span>{name.slice(0, 1).toUpperCase()}</span>
      </div>
    );
  }
  return (
    <img
      className={banner ? 'venue-photo venue-photo-banner' : 'venue-photo'}
      src={src}
      alt={`${name} photo`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
