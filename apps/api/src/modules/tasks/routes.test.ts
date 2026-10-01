import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerTaskRoutes } from './routes.js';
import { ConversationError } from '../conversations/service.js';

describe('task intake routes', () => {
  const auth = async () => 'alice';
  it('stores corrected text proposals without provider writes', async () => {
    const saved: unknown[] = [];
    const app = Fastify();
    registerTaskRoutes(app, { authenticate: auth, plan: async () => ({ reply: 'I prepared a Jira issue for you to review.', tasks: [{ id: 'task-1', action: 'jira.create', connectionId: null, destination: 'SFT', parameters: {}, uncertainties: [], state: 'proposed' }] }), save: async (_owner, text, tasks) => { saved.push({ text, tasks }); } });
    const response = await app.inject({ method: 'POST', url: '/instructions', payload: { text: 'Corrected instruction', locale: 'en-GB', timeZone: 'Europe/Istanbul' } });
    expect(response.statusCode).toBe(201);
    expect(response.json().reply).toBe('I prepared a Jira issue for you to review.');
    expect(response.json().tasks).toHaveLength(1);
    expect(saved).toMatchObject([{ text: 'Corrected instruction' }]);
    await app.close();
  });

  it('rejects oversized audio and lets failed transcription be retried', async () => {
    let calls = 0;
    const app = Fastify({ bodyLimit: 16 * 1024 * 1024 });
    registerTaskRoutes(app, { authenticate: auth, plan: async () => ({ reply: '', tasks: [] }), save: async () => {}, transcribe: async () => { calls++; if (calls === 1) throw new Error('provider error'); return 'retry transcript'; } });
    const audioBase64 = Buffer.from('audio').toString('base64');
    const payload = { audioBase64, mimeType: 'audio/webm' };
    expect((await app.inject({ method: 'POST', url: '/transcriptions', payload })).statusCode).toBe(502);
    const retry = await app.inject({ method: 'POST', url: '/transcriptions', payload });
    expect(retry.json()).toEqual({ text: 'retry transcript' });
    const tooLarge = await app.inject({ method: 'POST', url: '/transcriptions', payload: { audioBase64: Buffer.alloc(11 * 1024 * 1024).toString('base64'), mimeType: 'audio/webm' } });
    expect(tooLarge.statusCode).toBe(413);
    await app.close();
  });

  it('accepts browser recordings labelled with codec parameters and passes the base type on', async () => {
    const seen: string[] = [];
    const app = Fastify({ bodyLimit: 16 * 1024 * 1024 });
    registerTaskRoutes(app, { authenticate: auth, plan: async () => ({ reply: '', tasks: [] }), save: async () => {}, transcribe: async (_audio, mimeType) => { seen.push(mimeType); return 'ok'; } });
    const audioBase64 = Buffer.from('audio').toString('base64');
    for (const mimeType of ['audio/webm;codecs=opus', 'Audio/WebM; codecs=opus', 'audio/mp4;codecs=mp4a.40.2']) {
      expect((await app.inject({ method: 'POST', url: '/transcriptions', payload: { audioBase64, mimeType } })).json()).toEqual({ text: 'ok' });
    }
    expect(seen).toEqual(['audio/webm', 'audio/webm', 'audio/mp4']);
    expect((await app.inject({ method: 'POST', url: '/transcriptions', payload: { audioBase64, mimeType: 'audio/ogg;codecs=opus' } })).statusCode).toBe(400);
    await app.close();
  });

  it('returns Kian\'s explanation, with no tasks, when the request is out of scope', async () => {
    const app = Fastify();
    const saved: unknown[] = [];
    registerTaskRoutes(app, { authenticate: auth, plan: async () => ({ reply: 'I cannot book flights, but I can create calendar events.', tasks: [] }), save: async (_owner, _text, tasks) => { saved.push(tasks); } });
    const response = await app.inject({ method: 'POST', url: '/instructions', payload: { text: 'Book me a flight' } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ reply: 'I cannot book flights, but I can create calendar events.', tasks: [] });
    expect(saved).toEqual([[]]);
    await app.close();
  });

  it('sends a message into a saved conversation and returns the conversation id with Kian\'s reply', async () => {
    const seen: unknown[] = [];
    const app = Fastify();
    registerTaskRoutes(app, { authenticate: auth, plan: async () => ({ reply: '', tasks: [] }), save: async () => {}, converse: async (owner, input) => { seen.push({ owner, ...input }); return { conversationId: 'c1', reply: 'When?', tasks: [] }; } });
    const response = await app.inject({ method: 'POST', url: '/instructions', payload: { text: 'Plan a meeting', conversationId: 'c1', locale: 'en-GB', timeZone: 'Europe/London' } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ conversationId: 'c1', reply: 'When?', tasks: [] });
    expect(seen).toEqual([{ owner: 'alice', text: 'Plan a meeting', conversationId: 'c1', locale: 'en-GB', timeZone: 'Europe/London' }]);
    expect((await app.inject({ method: 'POST', url: '/instructions', payload: { text: 'x', conversationId: 5 } })).statusCode).toBe(400);
    await app.close();
  });

  it('turns conversation limits and ownership errors into clear responses, and other failures stay errors', async () => {
    const app = Fastify();
    let error: Error = new ConversationError(429, 'Slow down.');
    registerTaskRoutes(app, { authenticate: auth, plan: async () => ({ reply: '', tasks: [] }), save: async () => {}, converse: async () => { throw error; } });
    const limited = await app.inject({ method: 'POST', url: '/instructions', payload: { text: 'x' } });
    expect([limited.statusCode, limited.json()]).toEqual([429, { error: 'Slow down.' }]);
    error = new Error('model down');
    expect((await app.inject({ method: 'POST', url: '/instructions', payload: { text: 'x' } })).statusCode).toBe(500);
    await app.close();
  });

  it('returns the latest conversation of the signed-in user and can start a new one', async () => {
    const app = Fastify();
    registerTaskRoutes(app, { authenticate: auth, plan: async () => ({ reply: '', tasks: [] }), save: async () => {}, conversations: { latest: async owner => ({ conversationId: `c-${owner}`, messages: [] }), create: async owner => `new-${owner}` } });
    expect((await app.inject({ method: 'GET', url: '/conversations/latest' })).json()).toEqual({ conversationId: 'c-alice', messages: [] });
    const created = await app.inject({ method: 'POST', url: '/conversations' });
    expect([created.statusCode, created.json()]).toEqual([201, { conversationId: 'new-alice' }]);
    await app.close();
  });
});
