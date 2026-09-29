import { useEffect, useRef, useState } from 'react';
import { gsap, motionAllowed } from './motion.js';

export type Theme = 'light' | 'dark';
const storageKey = 'threadline-theme';
const chrome: Record<Theme, string> = { light: '#f4f5f0', dark: '#0e110e' };

const savedTheme = (): Theme | undefined => {
  try {
    const value = localStorage.getItem(storageKey);
    return value === 'light' || value === 'dark' ? value : undefined;
  } catch { return undefined; }
};

const saveTheme = (value: Theme): boolean => {
  try {
    localStorage.setItem(storageKey, value);
    return true;
  } catch { return false; }
};

const initialTheme = (): Theme => savedTheme() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const icon = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chrome[theme]);
  }, [theme]);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;
    if (motionAllowed()) {
      root.classList.add('theme-fade');
      window.setTimeout(() => root.classList.remove('theme-fade'), 400);
      if (icon.current) gsap.fromTo(icon.current, { rotate: -90, scale: .6 }, { rotate: 0, scale: 1, duration: .5, ease: 'back.out(2)' });
    }
    saveTheme(next);
    setTheme(next);
  };
  const dark = theme === 'dark';
  return <button type="button" className="theme-toggle" onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Light theme' : 'Dark theme'}><span ref={icon} aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{dark ? <path d="M12 3a1 1 0 011 1v1a1 1 0 11-2 0V4a1 1 0 011-1zM12 19a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM4.2 4.2a1 1 0 011.4 0l.7.7a1 1 0 01-1.4 1.4l-.7-.7a1 1 0 010-1.4zM17.7 17.7a1 1 0 011.4 0l.7.7a1 1 0 01-1.4 1.4l-.7-.7a1 1 0 010-1.4zM3 12a1 1 0 011-1h1a1 1 0 110 2H4a1 1 0 01-1-1zM19 12a1 1 0 011-1h1a1 1 0 110 2h-1a1 1 0 01-1-1zM12 8a4 4 0 100 8 4 4 0 000-8z" /> : <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />}</svg></span></button>;
}

export function useThemeName(): Theme {
  const read = (): Theme => document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
