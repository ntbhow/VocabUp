import { useEffect, useState } from 'react';

const NAVIGATE_EVENT = 'vocabup:admin-navigate';

/** Minimal client-side router for the admin console (mirrors the user app's pushState approach). */
export function navigate(path: string): void {
  if (window.location.pathname === path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function usePathname(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener(NAVIGATE_EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(NAVIGATE_EVENT, update);
    };
  }, []);
  return path;
}
