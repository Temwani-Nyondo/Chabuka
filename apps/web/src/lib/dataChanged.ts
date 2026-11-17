import { useEffect } from 'react';

// One signal for "your data changed somewhere else on this screen" (Gaffer made or joined a game, booked a space...).
// Screens that show that data listen and reload, so a game Gaffer just made is on Today and You straight away.

const EVENT = 'chabuka:data-changed';

export function notifyDataChanged(): void {
  window.dispatchEvent(new Event(EVENT));
}

/** Calls `reload` whenever data changes elsewhere. */
export function useDataChanged(reload: () => void): void {
  useEffect(() => {
    const fn = () => reload();
    window.addEventListener(EVENT, fn);
    return () => window.removeEventListener(EVENT, fn);
  }, [reload]);
}
