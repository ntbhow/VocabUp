import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

export type ThemePreference = 'light' | 'dark' | 'system';
const key = 'vocabup-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
function readPreference(): ThemePreference {
  try { const value = localStorage.getItem(key); return value === 'light' || value === 'dark' ? value : 'system'; }
  catch { return 'system'; }
}
function apply(preference: ThemePreference) {
  const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#15131e' : '#f7f6fa');
}
// Apply before React renders so the first screen uses the saved preference.
apply(readPreference());
media.addEventListener('change', () => apply(readPreference()));
window.addEventListener('storage', event => { if (event.key === key || event.key === null) apply(readPreference()); });

export function ThemeSelect() {
  const [preference, setPreference] = useState(readPreference);
  useEffect(() => {
    const sync = () => setPreference(readPreference());
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const Icon = preference === 'system' ? Monitor : preference === 'dark' ? Moon : Sun;
  return <label className="theme-select" title="Chế độ giao diện">
    <Icon size={17} aria-hidden="true" />
    <select aria-label="Chế độ giao diện" value={preference} onChange={event => {
      const next = event.target.value as ThemePreference;
      setPreference(next);
      try { localStorage.setItem(key, next); } catch { /* Still apply when storage is unavailable. */ }
      apply(next);
    }}>
      <option value="light">Sáng</option>
      <option value="dark">Tối</option>
      <option value="system">Theo hệ thống</option>
    </select>
  </label>;
}
