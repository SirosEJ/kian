import { describe, expect, it, vi } from 'vitest';
import { createRequireUser } from './session.js';

describe('session', () => {
  const verify = async (token: string) => {
    if (token !== 'valid-token') throw new Error('Invalid token');
    return { uid: 'user-1' };
  };

  it('returns the verified owner ID', async () => {
    const requireUser = createRequireUser(verify);
    expect(await requireUser({ headers: { authorization: 'Bearer valid-token' } })).toBe('user-1');
  });

  it('rejects missing or invalid tokens', async () => {
    const requireUser = createRequireUser(verify);
    await expect(requireUser({ headers: {} })).rejects.toMatchObject({ statusCode: 401 });
    await expect(requireUser({ headers: { authorization: 'Bearer invalid' } })).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('session diagnostics', () => {
  it('logs only the failure code, never the token', async () => {
    const warn = vi.fn();
    const requireUser = createRequireUser(async () => { throw Object.assign(new Error('secret detail'), { code: 'auth/insufficient-permission' }); });
    await expect(requireUser({ headers: { authorization: 'Bearer abc' }, log: { warn } })).rejects.toMatchObject({ statusCode: 401 });
    expect(warn).toHaveBeenCalledWith({ code: 'auth/insufficient-permission' }, 'Token verification failed');
  });
});
