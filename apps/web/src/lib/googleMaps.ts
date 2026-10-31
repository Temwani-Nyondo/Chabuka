/// <reference types="google.maps" />
// Loads the Google Maps JavaScript API (with Places) once, from the
// browser key in apps/web/.env. Amendment 3: Google powers venue search
// and picking only; Explore stays on Leaflet/OpenStreetMap.
let loading: Promise<typeof google | null> | null = null;

export function googleMapsKey(): string {
  return ((import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '').trim();
}

export function loadGoogleMaps(): Promise<typeof google | null> {
  const key = googleMapsKey();
  if (!key) return Promise.resolve(null);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const w = window as unknown as { google?: typeof google; __chabukaMapsReady?: () => void };
    if (w.google?.maps) {
      resolve(w.google);
      return;
    }
    w.__chabukaMapsReady = () => resolve(w.google ?? null);
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=__chabukaMapsReady&loading=async`;
    script.async = true;
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return loading;
}
