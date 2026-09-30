import { getUserToken } from './auth.js';

const base = import.meta.env.VITE_API_URL || '';
export async function apiRequest(path: string, method = 'GET', payload?: unknown) {
  const token = await getUserToken();
  const response = await fetch(`${base}${path}`, { method, headers: { ...(payload === undefined ? {} : { 'Content-Type':'application/json' }), Authorization:`Bearer ${token}` }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    throw Object.assign(new Error(detail?.error || `Request failed (${response.status})`), { status: response.status });
  }
  return response.status === 204 ? null : response.json();
}
