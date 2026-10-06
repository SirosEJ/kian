import { getUserToken } from './auth.js';

const base = import.meta.env.VITE_API_URL || '';
export async function apiRequest(path: string, method = 'GET', payload?: unknown) {
  const token = await getUserToken();
  const response = await fetch(`${base}${path}`, { method, headers: { ...(payload === undefined ? {} : { 'Content-Type':'application/json' }), Authorization:`Bearer ${token}` }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  if (!response.ok) {
    // The API's own errors carry the reason in `error`; errors raised inside it carry the reason in `message` and only the status name in `error`.
    const detail = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw Object.assign(new Error(detail?.message || detail?.error || `Request failed (${response.status})`), { status: response.status });
  }
  return response.status === 204 ? null : response.json();
}

/** A binary answer (an image) from the API, with the signed-in user's token. */
export async function apiBlob(path: string): Promise<Blob> {
  const token = await getUserToken();
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw Object.assign(new Error(`Request failed (${response.status})`), { status: response.status });
  return response.blob();
}
