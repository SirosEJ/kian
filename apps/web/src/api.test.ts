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
});
