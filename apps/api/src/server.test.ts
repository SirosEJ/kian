import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';

describe('health', () => {
  it('returns an ok status', async () => {
    const app = buildServer();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});

describe('protected API', () => {
  const verifyToken = async (token: string) => {
    if (token !== 'alice-token') throw new Error('invalid');
    return { uid: 'alice' };
  };
  const repository = {
    getTask: async (owner: string, id: string) => owner === 'alice' && id === 'alice-task' ? { id, owner_id: owner, action: 'jira.create', state: 'proposed', parameters: {}, version: 1 } : null,
  };

  it('rejects anonymous access and an inaccessible task ID', async () => {
    const app = buildServer({ verifyToken, repository });
    expect((await app.inject({ method: 'GET', url: '/tasks/alice-task' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/tasks/bob-task', headers: { authorization: 'Bearer alice-token' } })).statusCode).toBe(404);
    const own = await app.inject({ method: 'GET', url: '/tasks/alice-task', headers: { authorization: 'Bearer alice-token' } });
    expect(own.statusCode).toBe(200);
    expect(own.json().id).toBe('alice-task');
    await app.close();
  });
});
