import { useCallback, useEffect, useState } from 'react';

// What the player picked. 'system' follows the phone's light/dark setting.
export type ThemePref = 'light' | 'dark' | 'system';
// What is actually painted right now.
export type Theme = 'light' | 'dark';

const KEY = 'chabuka-theme';
const EVENT = 'chabuka-theme-change';
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function getSavedPref(): ThemePref {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // Private mode or blocked storage: fall through to the default.
  }
  return 'system';
}

export function resolveTheme(pref: ThemePref): Theme {
  if (pref === 'system') return media?.matches ? 'dark' : 'light';
  return pref;
}

// Paints the resolved theme on <html> (index.css reads [data-theme]) and keeps
// the browser chrome colour in step with the page background.
export function paintTheme(pref: ThemePref): Theme {
  const theme = resolveTheme(pref);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d0f0e' : '#f6f7f5');
  return theme;
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // Storage blocked: the choice still applies for this visit.
  }
  paintTheme(pref);
  window.dispatchEvent(new CustomEvent<ThemePref>(EVENT, { detail: pref }));
}

// Runs once before React mounts so the first paint is already themed, and
// follows the OS switch live while the preference is 'system'.
export function bootTheme(): void {
  paintTheme(getSavedPref());
  media?.addEventListener('change', () => {
    if (getSavedPref() === 'system') paintTheme('system');
  });
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(getSavedPref);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(getSavedPref()));

  useEffect(() => {
    const onPref = (e: Event) => {
      const next = (e as CustomEvent<ThemePref>).detail;
      setPref(next);
      setTheme(resolveTheme(next));
    };
    const onMedia = () => setTheme(resolveTheme(getSavedPref()));
    window.addEventListener(EVENT, onPref as EventListener);
    media?.addEventListener('change', onMedia);
    return () => {
      window.removeEventListener(EVENT, onPref as EventListener);
      media?.removeEventListener('change', onMedia);
    };
  }, []);

  const choose = useCallback((next: ThemePref) => setThemePref(next), []);
  const toggle = useCallback(() => setThemePref(resolveTheme(getSavedPref()) === 'dark' ? 'light' : 'dark'), []);

  return { pref, theme, choose, toggle };
}
