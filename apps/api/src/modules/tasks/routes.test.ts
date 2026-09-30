import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerTaskRoutes } from './routes.js';

describe('task intake routes', () => {
  const auth = async () => 'alice';
  it('stores corrected text proposals without provider writes', async () => {
    const saved: unknown[] = [];
    const app = Fastify();
    registerTaskRoutes(app, { authenticate: auth, plan: async () => [{ id: 'task-1', action: 'jira.create', connectionId: null, destination: 'SFT', parameters: {}, uncertainties: [], state: 'proposed' }], save: async (_owner, text, tasks) => { saved.push({ text, tasks }); } });
    const response = await app.inject({ method: 'POST', url: '/instructions', payload: { text: 'Corrected instruction', locale: 'en-GB', timeZone: 'Europe/Istanbul' } });
    expect(response.statusCode).toBe(201);
    expect(saved).toMatchObject([{ text: 'Corrected instruction' }]);
    await app.close();
  });

  it('rejects oversized audio and lets failed transcription be retried', async () => {
    let calls = 0;
    const app = Fastify({ bodyLimit: 16 * 1024 * 1024 });
    registerTaskRoutes(app, { authenticate: auth, plan: async () => [], save: async () => {}, transcribe: async () => { calls++; if (calls === 1) throw new Error('provider error'); return 'retry transcript'; } });
    const audioBase64 = Buffer.from('audio').toString('base64');
    const payload = { audioBase64, mimeType: 'audio/webm' };
    expect((await app.inject({ method: 'POST', url: '/transcriptions', payload })).statusCode).toBe(502);
    const retry = await app.inject({ method: 'POST', url: '/transcriptions', payload });
    expect(retry.json()).toEqual({ text: 'retry transcript' });
    const tooLarge = await app.inject({ method: 'POST', url: '/transcriptions', payload: { audioBase64: Buffer.alloc(11 * 1024 * 1024).toString('base64'), mimeType: 'audio/webm' } });
    expect(tooLarge.statusCode).toBe(413);
    await app.close();
  });
});
