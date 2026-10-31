import { useEffect, useRef, useState } from 'react';
import { DEFAULT_MAP_CENTER } from '@chabuka/shared';
import { googleMapsKey, loadGoogleMaps } from '../lib/googleMaps';

export interface GooglePlacePick {
  placeId?: string;
  venueName?: string;
  lat?: number;
  lng?: number;
  areaText?: string;
}

interface Props {
  onPick: (pick: GooglePlacePick) => void;
}

interface Suggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

// Google place search + map (Amendment 3), on the Places API (New):
// type a place and it renders on the map; drop or drag the pin and the
// box fills from reverse geocoding.
export default function GooglePlacePicker({ onPick }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const sessionRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const debounceRef = useRef<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'ready' | 'unavailable'>('idle');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [hint, setHint] = useState(
    googleMapsKey()
      ? 'Search for a place, or tap the map to drop a pin.'
      : 'Google search is off until VITE_GOOGLE_MAPS_API_KEY is set in apps/web/.env — listed venues and the pin still work.',
  );

  useEffect(() => {
    let cancelled = false;
    if (!googleMapsKey()) {
      setStatus('unavailable');
      return;
    }
    void (async () => {
      const g = await loadGoogleMaps();
      if (cancelled || !g || !mapRef.current) {
        if (!cancelled) setStatus('unavailable');
        return;
      }
      const map = new g.maps.Map(mapRef.current, {
        center: DEFAULT_MAP_CENTER,
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
      });
      mapObjRef.current = map;
      markerRef.current = new g.maps.Marker({ map, draggable: true, visible: false });
      geocoderRef.current = new g.maps.Geocoder();
      sessionRef.current = new g.maps.places.AutocompleteSessionToken();

      const reverse = (lat: number, lng: number) => {
        geocoderRef.current?.geocode({ location: { lat, lng } }, (results, geocodeStatus) => {
          const first = geocodeStatus === 'OK' ? results?.[0] : undefined;
          const text = first?.formatted_address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          if (inputRef.current) inputRef.current.value = text;
          setHint(`Pin: ${text}`);
          onPick({ lat, lng, placeId: first?.place_id, venueName: text, areaText: text });
        });
      };

      map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng || !markerRef.current) return;
        markerRef.current.setPosition(e.latLng);
        markerRef.current.setVisible(true);
        reverse(e.latLng.lat(), e.latLng.lng());
      });
      markerRef.current.addListener('dragend', () => {
        const pos = markerRef.current?.getPosition();
        if (pos) reverse(pos.lat(), pos.lng());
      });

      if (!cancelled) setStatus('ready');
    })();
    return () => {
      cancelled = true;
    };
    // onPick is a setState-style callback from the parent form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = (text: string) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (text.trim().length < 3 || status !== 'ready') {
      setSuggestions([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const g = window.google;
          if (!g) return;
          if (!sessionRef.current) {
            sessionRef.current = new g.maps.places.AutocompleteSessionToken();
          }
          const { suggestions: found } =
            await g.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
              input: text,
              includedRegionCodes: ['ZM'],
              sessionToken: sessionRef.current,
            });
          setSuggestions(
            found
              .map((s) => s.placePrediction)
              .filter((p): p is google.maps.places.PlacePrediction => Boolean(p))
              .map((p) => ({
                placeId: p.placeId,
                mainText: p.mainText?.text ?? p.text.text,
                secondaryText: p.secondaryText?.text ?? '',
              }))
              .slice(0, 5),
          );
        } catch {
          setSuggestions([]);
          setHint('Place search failed — check the key allows the Places API (New), or drop a pin.');
        }
      })();
    }, 250);
  };

  const choose = (suggestion: Suggestion) => {
    void (async () => {
      try {
        const g = window.google;
        if (!g || !mapObjRef.current || !markerRef.current) return;
        const place = new g.maps.places.Place({ id: suggestion.placeId });
        await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
        sessionRef.current = new g.maps.places.AutocompleteSessionToken();
        const loc = place.location;
        if (!loc) return;
        const lat = loc.lat();
        const lng = loc.lng();
        markerRef.current.setPosition(loc);
        markerRef.current.setVisible(true);
        mapObjRef.current.panTo(loc);
        mapObjRef.current.setZoom(15);
        const label = place.displayName ?? suggestion.mainText;
        if (inputRef.current) inputRef.current.value = label;
        setSuggestions([]);
        setHint(`Selected: ${label}`);
        onPick({
          lat,
          lng,
          placeId: suggestion.placeId,
          venueName: label,
          areaText: place.formattedAddress ?? label,
        });
      } catch {
        setHint('Could not load that place — try another, or drop a pin.');
      }
    })();
  };

  return (
    <>
      <input
        ref={inputRef}
        className="input"
        placeholder="Search a place in Zambia — e.g. Showgrounds, Lusaka"
        aria-label="Search a place"
        disabled={status === 'unavailable'}
        onChange={(e) => search(e.target.value)}
      />
      {suggestions.length > 0 ? (
        <div>
          {suggestions.map((s) => (
            <button
              key={s.placeId}
              type="button"
              className="venue-option"
              onClick={() => choose(s)}
            >
              <strong>{s.mainText}</strong>
              {s.secondaryText ? <span className="muted">{s.secondaryText}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className="map-box" ref={mapRef} aria-label="Google map for venue picking" />
      <p className="hint">{hint}</p>
    </>
  );
}
