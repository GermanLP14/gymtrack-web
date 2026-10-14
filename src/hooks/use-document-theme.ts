import { useEffect } from 'react';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';

function loadFont() {
  if (document.querySelector(`link[href="${FONT_HREF}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_HREF;
  document.head.appendChild(link);
}

/**
 * Mirrors the app's theme onto the page itself, so browser-drawn parts
 * (native <select> lists, scrollbars, autofill, overscroll) match it too.
 */
export function useDocumentTheme() {
  const scheme = useColorScheme();
  useEffect(loadFont, []);
  useEffect(() => {
    const theme = Colors[scheme];
    const root = document.documentElement;
    root.style.colorScheme = scheme;
    root.dataset.theme = scheme;
    root.style.setProperty('--scrollbar-thumb', scheme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(15,18,34,0.18)');
    root.style.setProperty('--focus-ring', theme.accent);
    document.body.style.backgroundColor = theme.background;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.background);
  }, [scheme]);
}
