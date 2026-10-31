import { useEffect, useState } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import { DEFAULT_MAP_CENTER } from '@chabuka/shared';
import type { Venue } from '@chabuka/shared';
import type { MatchListing } from '../lib/matches';
import { fetchVenues } from '../lib/venues';
import 'leaflet/dist/leaflet.css';

interface Props {
  listings: MatchListing[];
  onSelect: (listing: MatchListing) => void;
}

// Explore map (brief section 7): pins for open matches and listed venues.
// Matches without coordinates yet stay in the list view only.
export default function ExploreMap({ listings, onSelect }: Props) {
  const [venues, setVenues] = useState<Venue[]>([]);

  useEffect(() => {
    fetchVenues()
      .then(setVenues)
      .catch(() => setVenues([]));
  }, []);

  const pinned = listings
    .map((listing) => {
      const lat = listing.match.lat ?? listing.venue?.lat;
      const lng = listing.match.lng ?? listing.venue?.lng;
      return lat != null && lng != null ? { listing, lat, lng } : null;
    })
    .filter((p): p is { listing: MatchListing; lat: number; lng: number } => p !== null);

  const first = pinned[0];
  const center: [number, number] = first
    ? [first.lat, first.lng]
    : [DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng];

  return (
    <div className="map-box map-box-tall">
      <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {venues
          .filter((v) => v.lat != null && v.lng != null)
          .map((venue) => (
            <CircleMarker
              key={`venue-${venue.id}`}
              center={[venue.lat as number, venue.lng as number]}
              radius={7}
              pathOptions={{ color: '#101713', fillColor: '#ffffff', fillOpacity: 0.95 }}
            >
              <Popup>
                <strong>{venue.name}</strong>
                <br />
                {[venue.area, venue.price_note].filter(Boolean).join(' · ')}
              </Popup>
            </CircleMarker>
          ))}
        {pinned.map(({ listing, lat, lng }) => (
          <CircleMarker
            key={`match-${listing.match.id}`}
            center={[lat, lng]}
            radius={10}
            pathOptions={{ color: '#16a34a', fillColor: '#2fd672', fillOpacity: 0.9 }}
            eventHandlers={{ click: () => onSelect(listing) }}
          >
            <Popup>
              <strong>{listing.match.title}</strong>
              <br />
              {listing.venue?.name ?? listing.match.area ?? 'Area to be confirmed'} ·{' '}
              {listing.joinedCount}/{listing.match.capacity} players in
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      {pinned.length === 0 ? (
        <p className="hint">No matches with a venue or pin yet — they still show in the list.</p>
      ) : null}
    </div>
  );
}
