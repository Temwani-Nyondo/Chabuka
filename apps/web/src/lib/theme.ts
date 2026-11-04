import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'chabuka-theme';
const EVENT = 'chabuka-theme-change';

export function getSavedTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  // Brand default is the dark floodlight look; light stays one tap away.
  return 'dark';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(KEY, theme);
}

// Synchronous flip: reads the live DOM attribute (the actual source of
// truth), writes DOM + storage immediately so the switch is visible even
// before React re-renders, then broadcasts for every other useTheme hook.
export function toggleTheme(): Theme {
  const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const next: Theme = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  window.dispatchEvent(new CustomEvent<Theme>(EVENT, { detail: next }));
  return next;
}

// Placeholder theme tokens live in index.css under [data-theme]; the real
// visual identity swaps in there later.
export type Skin = 'floodlight' | 'clean' | 'stripes' | 'matchday';
export const SKINS: { value: Skin; label: string }[] = [
  { value: 'floodlight', label: 'Floodlight' },
  { value: 'matchday', label: 'Matchday' },
  { value: 'clean', label: 'Clean' },
  { value: 'stripes', label: 'Stripes' },
];

const SKIN_KEY = 'chabuka-skin';

export function getSavedSkin(): Skin {
  const saved = localStorage.getItem(SKIN_KEY);
  return saved === 'clean' || saved === 'stripes' || saved === 'matchday' ? saved : 'floodlight';
}

export function applySkin(skin: Skin) {
  document.documentElement.dataset.skin = skin;
  localStorage.setItem(SKIN_KEY, skin);
}

export function useSkin() {
  const [skin, setSkin] = useState<Skin>(getSavedSkin);

  useEffect(() => {
    applySkin(skin);
  }, [skin]);

  return { skin, setSkin };
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getSavedTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Every toggle button (top bar, profile) stays in sync in-session.
  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<Theme>).detail;
      if (next === 'light' || next === 'dark') setTheme(next);
    };
    window.addEventListener(EVENT, onChange as EventListener);
    return () => window.removeEventListener(EVENT, onChange as EventListener);
  }, []);

  // No side effects inside the updater: toggleTheme() already wrote the
  // DOM, storage, and broadcast; here we only sync this hook's state.
  const toggle = useCallback(() => {
    setTheme(toggleTheme());
  }, []);

  return { theme, toggle };
}
