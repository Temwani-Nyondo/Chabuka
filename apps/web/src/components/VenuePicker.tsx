import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import { DEFAULT_MAP_CENTER } from '@chabuka/shared';
import type { Venue } from '@chabuka/shared';
import { fetchVenues } from '../lib/venues';
import GooglePlacePicker from './GooglePlacePicker';
import 'leaflet/dist/leaflet.css';

export interface VenuePick {
  venueId?: string;
  placeId?: string;
  venueName?: string;
  lat?: number;
  lng?: number;
}

interface Props {
  sportName?: string;
  area: string;
  onAreaChange: (area: string) => void;
  onPick: (pick: VenuePick) => void;
}

type Mode = 'venue' | 'search' | 'pin';

function PinDropper({ onDrop }: { onDrop: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onDrop(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Venue input for Create Match: pick a listed venue, or drop a pin on the
// map, or just type an area. A listed venue carries its own pin; a dropped
// pin is the organiser's confirmed location (brief section 7).
export default function VenuePicker({ sportName, area, onAreaChange, onPick }: Props) {
  const [mode, setMode] = useState<Mode>('venue');
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    fetchVenues(sportName)
      .then(setVenues)
      .catch((err: unknown) =>
        setLoadError(err instanceof Error ? err.message : 'Could not load venues.'),
      );
  }, [sportName]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return venues;
    return venues.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.area ?? '').toLowerCase().includes(q) ||
        v.facility_types.some((f) => f.toLowerCase().includes(q)),
    );
  }, [venues, query]);

  const chooseVenue = (venue: Venue) => {
    setSelectedId(venue.id);
    setPin(null);
    if (venue.area) onAreaChange(venue.area);
    onPick({
      venueId: venue.id,
      venueName: venue.name,
      placeId: venue.google_place_id ?? undefined,
      lat: venue.lat ?? undefined,
      lng: venue.lng ?? undefined,
    });
  };

  const dropPin = (lat: number, lng: number) => {
    setPin({ lat, lng });
    setSelectedId(null);
    onPick({ lat, lng });
  };

  const clearPick = () => {
    setSelectedId(null);
    setPin(null);
    onPick({});
  };

  const center: [number, number] = pin
    ? [pin.lat, pin.lng]
    : [DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng];

  return (
    <div className="field">
      <span>Venue</span>
      <div className="chips" role="tablist" aria-label="Venue input mode">
        <button
          type="button"
          className={mode === 'venue' ? 'chip chip-active' : 'chip'}
          onClick={() => setMode('venue')}
        >
          Listed venues
        </button>
        <button
          type="button"
          className={mode === 'search' ? 'chip chip-active' : 'chip'}
          onClick={() => setMode('search')}
        >
          Search a place
        </button>
        <button
          type="button"
          className={mode === 'pin' ? 'chip chip-active' : 'chip'}
          onClick={() => setMode('pin')}
        >
          Drop a pin
        </button>
      </div>

      {mode === 'search' ? (
        <GooglePlacePicker
          onPick={(pick) => {
            setSelectedId(null);
            setPin(pick.lat != null && pick.lng != null ? { lat: pick.lat, lng: pick.lng } : null);
            if (pick.areaText) onAreaChange(pick.areaText.slice(0, 80));
            onPick({
              placeId: pick.placeId,
              venueName: pick.venueName,
              lat: pick.lat,
              lng: pick.lng,
            });
          }}
        />
      ) : null}

      {mode === 'venue' ? (
        <>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search venues or areas"
            aria-label="Search venues"
          />
          {loadError ? <p className="error">{loadError}</p> : null}
          {!loadError && venues.length === 0 ? (
            <p className="hint">No listed venues yet — drop a pin or type the area below.</p>
          ) : null}
          {visible.map((venue) => (
            <button
              key={venue.id}
              type="button"
              className={selectedId === venue.id ? 'venue-option venue-option-active' : 'venue-option'}
              onClick={() => chooseVenue(venue)}
            >
              <strong>{venue.name}</strong>
              <span className="muted">
                {[venue.area, venue.facility_types.join(', '), venue.price_note]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          ))}
          {venues.length > 0 && visible.length === 0 ? (
            <p className="hint">No venue matches that search — drop a pin instead.</p>
          ) : null}
        </>
      ) : mode === 'pin' ? (
        <>
          <div className="map-box">
            <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <PinDropper onDrop={dropPin} />
              {pin ? (
                <CircleMarker
                  center={[pin.lat, pin.lng]}
                  radius={10}
                  pathOptions={{ color: '#16a34a', fillColor: '#2fd672', fillOpacity: 0.9 }}
                />
              ) : null}
              {venues
                .filter((v) => v.lat != null && v.lng != null)
                .map((venue) => (
                  <CircleMarker
                    key={venue.id}
                    center={[venue.lat as number, venue.lng as number]}
                    radius={7}
                    pathOptions={{ color: '#101713', fillColor: '#ffffff', fillOpacity: 0.9 }}
                    eventHandlers={{ click: () => chooseVenue(venue) }}
                  />
                ))}
            </MapContainer>
          </div>
          <p className="hint">
            {pin
              ? `Pin set at ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}. Tap the map to move it.`
              : 'Tap the map where you will play. White dots are listed venues — tap one to pick it.'}
          </p>
        </>
      ) : null}

      <label className="field">
        Area
        <input
          className="input"
          value={area}
          onChange={(e) => {
            onAreaChange(e.target.value);
          }}
          placeholder="e.g. Woodlands"
          maxLength={80}
        />
      </label>
      {selectedId || pin ? (
        <button type="button" className="btn btn-ghost" onClick={clearPick}>
          Clear venue / pin
        </button>
      ) : null}
    </div>
  );
}
