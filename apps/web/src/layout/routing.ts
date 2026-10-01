import { useSyncExternalStore } from 'react';

export const pages = ['/', '/activity', '/settings', '/account'] as const;
export type Page = (typeof pages)[number];

export const pageTitles: Record<Page, string> = { '/': 'Home', '/activity': 'Activity', '/settings': 'Settings', '/account': 'Account' };

/**
 * Decides which page a URL shows. Google and Jira send the user back to `/?code=...&state=...`;
 * that must complete on the Settings page, so it is redirected there with the query intact.
 */
export function resolveRoute(pathname: string, search: string): { page: Page | null; redirectTo?: string } {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const params = new URLSearchParams(search);
  if (path === '/' && params.has('code') && params.has('state')) return { page: '/settings', redirectTo: `/settings${search}` };
  return { page: (pages as readonly string[]).includes(path) ? (path as Page) : null };
}

const changeEvent = 'kian:navigate';

export function navigate(to: string, options: { replace?: boolean } = {}) {
  if (options.replace) window.history.replaceState({}, '', to); else window.history.pushState({}, '', to);
  window.dispatchEvent(new Event(changeEvent));
}

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(changeEvent, onChange);
  return () => { window.removeEventListener('popstate', onChange); window.removeEventListener(changeEvent, onChange); };
}

/** The current page (null when the path is unknown). Re-renders on navigation and on the browser back/forward buttons. */
export function useRoute(): Page | null {
  const location = useSyncExternalStore(subscribe, () => window.location.pathname + window.location.search, () => '/');
  const [pathname, search = ''] = location.split(/(?=\?)/);
  return resolveRoute(pathname, search).page;
}

/** Call once before the first render: moves a provider's return URL (`/?code=...&state=...`) to Settings so the page that completes the connection sees the code once. */
export function applyCallbackRedirect() {
  const { redirectTo } = resolveRoute(window.location.pathname, window.location.search);
  if (redirectTo) window.history.replaceState({}, '', redirectTo);
}
