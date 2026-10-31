import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'chabuka-theme';

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

// Placeholder theme tokens live in index.css under [data-theme]; the real
// visual identity swaps in there later.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getSavedTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  }, []);

  return { theme, toggle };
}
