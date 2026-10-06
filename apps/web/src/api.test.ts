import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./auth.js', () => ({ getUserToken: async () => 'token' }));

import { apiRequest } from './api.js';

describe('apiRequest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('omits the JSON content type when there is no body, which the API rejects', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await apiRequest('/connections/google/start', 'POST');
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({ Authorization: 'Bearer token' });
    expect(init.body).toBeUndefined();
  });

  it('sends JSON content type with a body', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await apiRequest('/instructions', 'POST', { text: 'x' });
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer token' });
    expect(init.body).toBe('{"text":"x"}');
  });

  it('shows the real reason of an error raised inside the API, not the HTTP status name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ statusCode: 422, error: 'Unprocessable Entity', message: 'Trust scope must match this task' }), { status: 422 })));
    await expect(apiRequest('/tasks/x/decision', 'POST', {})).rejects.toMatchObject({ message: 'Trust scope must match this task', status: 422 });
  });

  it('still shows the reason of the API\'s own errors, and falls back to the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Select a writable calendar' }), { status: 422 })));
    await expect(apiRequest('/x', 'PUT', {})).rejects.toMatchObject({ message: 'Select a writable calendar' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 502 })));
    await expect(apiRequest('/x')).rejects.toMatchObject({ message: 'Request failed (502)', status: 502 });
  });
});
