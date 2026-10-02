import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { applyCorrections, replacementPairs, similarity, vocabularyPrompt } from './dictation.js';
import { createMemoryStore, learnTerms } from './store.js';
import { registerMemoryRoutes } from './routes.js';
import { registerTaskRoutes } from '../tasks/routes.js';

async function setup() {
  const db = new PGlite();
  for (const f of ['001_core.sql', '002_conversations.sql', '003_message_tasks.sql', '004_message_tables.sql', '005_memory.sql', '006_memory_corrections.sql']) await db.exec(await readFile(new URL(`../../../../../packages/db/migrations/${f}`, import.meta.url), 'utf8'));
  await db.query("INSERT INTO users(id) VALUES ('alice'),('bob')");
  return { db, store: createMemoryStore(db) };
}

describe('finding what the user corrected', () => {
  it('finds a spoken word replaced by a written look-alike, in either direction of length', () => {
    expect(replacementPairs('email Seros about the demo', 'email Siros about the demo')).toEqual([{ from: 'Seros', to: 'Siros' }]);
    expect(replacementPairs('ask Sol man to join', 'ask Solmaz to join')).toEqual([{ from: 'Sol man', to: 'Solmaz' }]);
    expect(replacementPairs('move sepenta tickets', 'move Sepenta tickets')).toEqual([]);
  });
  it('ignores insertions, deletions, rewordings and edits that are not look-alikes', () => {
    expect(replacementPairs('email Sam', 'email Sam about the demo')).toEqual([]);
    expect(replacementPairs('email Sam about the demo', 'email Sam')).toEqual([]);
    expect(replacementPairs('book a meeting tomorrow', 'book a call tomorrow')).toEqual([]);
    expect(replacementPairs('one two three four five', 'six seven eight nine ten')).toEqual([]);
    expect(replacementPairs('', 'x')).toEqual([]);
    expect(replacementPairs('word '.repeat(400), 'other '.repeat(400))).toEqual([]);
  });
  it('measures how alike two forms are', () => {
    expect(similarity('Seros', 'Siros')).toBeCloseTo(0.8);
    expect(similarity('Sol man', 'Solmaz')).toBeGreaterThan(0.5);
    expect(similarity('meeting', 'call')).toBeLessThan(0.5);
    expect(similarity('', 'a')).toBe(0);
  });
});

describe('applying corrections and building the vocabulary', () => {
  it('replaces whole words only, any case, and leaves other words alone', () => {
    expect(applyCorrections('Hello Seros, seros and Serosa', [{ from: 'Seros', to: 'Siros' }])).toBe('Hello Siros, Siros and Serosa');
    expect(applyCorrections('ask sol man', [{ from: 'Sol man', to: 'Solmaz' }])).toBe('ask Solmaz');
    expect(applyCorrections('a.b (c)', [{ from: 'a.b', to: 'x' }])).toBe('x (c)');
    expect(applyCorrections('no', [{ from: 'no', to: 'yes' }])).toBe('no');
  });
  it('lists the user\'s names for the transcription model, short, without addresses, and capped', () => {
    const prompt = vocabularyPrompt([{ kind: 'person', value: 'Solmaz Yilmaz', alias: 'Sol', detail: null }, { kind: 'person', value: 'sam@example.com', alias: null, detail: 'Emailed' }, { kind: 'epic', value: 'Onboarding Automation: Jira tours and a very long subtitle', alias: null, detail: 'SFT-267' }, { kind: 'correction', value: 'Siros', alias: 'Seros', detail: null }, { kind: 'person', value: 'solmaz yilmaz', alias: null, detail: null }]);
    expect(prompt).toBe('Names and terms the speaker may say: Kian, Jira, Sepenta, Google Calendar, Solmaz Yilmaz, Onboarding Automation, Siros.');
    const many = vocabularyPrompt(Array.from({ length: 200 }, (_, i) => ({ kind: 'person' as const, value: `Person Number ${i}`, alias: null, detail: null })));
    expect(many.length).toBeLessThanOrEqual(601);
    expect(many.endsWith('.')).toBe(true);
  });
});

describe('learning from edits made after dictating', () => {
  it('does not learn a one-off edit, learns the same change seen twice, and then applies it', async () => {
    const { db, store } = await setup();
    expect(await store.observeEdit('alice', 'email Seros', 'email Siros')).toBe(0);
    expect((await store.dictation('alice')).corrections).toEqual([]);
    expect(await store.observeEdit('alice', 'ask Seros to join', 'ask Siros to join')).toBe(1);
    const help = await store.dictation('alice');
    expect(help.corrections).toEqual([{ from: 'Seros', to: 'Siros' }]);
    expect(help.prompt).toContain('Siros');
    expect(applyCorrections('hello Seros', help.corrections)).toBe('hello Siros');
    expect(await store.observeEdit('alice', 'Seros again', 'Siros again')).toBe(0);
    await db.close();
  });
  it('keeps each user\'s edits and corrections apart', async () => {
    const { db, store } = await setup();
    await store.observeEdit('alice', 'email Seros', 'email Siros');
    await store.observeEdit('bob', 'email Seros', 'email Siri');
    await store.observeEdit('alice', 'ask Seros', 'ask Siros');
    expect((await store.dictation('alice')).corrections).toEqual([{ from: 'Seros', to: 'Siros' }]);
    expect((await store.dictation('bob')).corrections).toEqual([]);
    await db.close();
  });
  it('learns nothing and offers nothing while learning is off, and a deleted correction does not come straight back', async () => {
    const { db, store } = await setup();
    await store.setEnabled('alice', false);
    expect(await store.observeEdit('alice', 'email Seros', 'email Siros')).toBe(0);
    expect(await store.observeEdit('alice', 'email Seros', 'email Siros')).toBe(0);
    expect(await store.dictation('alice')).toEqual({ enabled: false, corrections: [], prompt: '' });
    await store.setEnabled('alice', true);
    await store.observeEdit('alice', 'a Seros', 'a Siros');
    await store.observeEdit('alice', 'b Seros', 'b Siros');
    const [correction] = (await store.view('alice')).terms.filter(t => t.kind === 'correction');
    await store.remove('alice', correction.id);
    expect((await store.dictation('alice')).corrections).toEqual([]);
    expect(await store.observeEdit('alice', 'c Seros', 'c Siros')).toBe(0);
    await db.close();
  });
  it('is deleted with everything else when the user deletes what Kian remembers or their account', async () => {
    const { db, store } = await setup();
    await store.observeEdit('alice', 'a Seros', 'a Siros');
    await store.clear('alice');
    expect((await db.query("SELECT count(*)::int AS n FROM memory_corrections_seen WHERE owner_id='alice'")).rows[0]).toEqual({ n: 0 });
    await store.observeEdit('bob', 'a Seros', 'a Siros');
    await db.query("DELETE FROM users WHERE id='bob'");
    expect((await db.query('SELECT count(*)::int AS n FROM memory_corrections_seen')).rows[0]).toEqual({ n: 0 });
    await db.close();
  });
});

describe('dictation routes', () => {
  it('serves the corrections to the browser and takes the edit after a send', async () => {
    const { db, store } = await setup();
    const app = Fastify();
    registerMemoryRoutes(app, store, async () => 'alice');
    expect((await app.inject({ method: 'GET', url: '/memory/dictation' })).json()).toEqual({ enabled: true, corrections: [] });
    expect((await app.inject({ method: 'POST', url: '/memory/dictation-edit', payload: { dictated: 'a Seros', final: 'a Siros' } })).json()).toEqual({ learned: 0 });
    expect((await app.inject({ method: 'POST', url: '/memory/dictation-edit', payload: { dictated: 'b Seros', final: 'b Siros' } })).json()).toEqual({ learned: 1 });
    expect((await app.inject({ method: 'GET', url: '/memory/dictation' })).json().corrections).toEqual([{ from: 'Seros', to: 'Siros' }]);
    expect((await app.inject({ method: 'POST', url: '/memory/dictation-edit', payload: { dictated: 1, final: 'x' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/memory/dictation-edit', payload: { dictated: 'x'.repeat(4001), final: 'x' } })).statusCode).toBe(400);
    await app.close(); await db.close();
  });
  it('gives the transcription model the vocabulary and applies the corrections to what it heard', async () => {
    const seen: (string | undefined)[] = [];
    const app = Fastify();
    registerTaskRoutes(app, { authenticate: async () => 'alice', plan: async () => ({ reply: '', tasks: [] }), save: async () => {}, transcribe: async (_a, _m, prompt) => { seen.push(prompt); return 'email Seros about Kian'; }, dictation: async () => ({ prompt: 'Names: Siros.', corrections: [{ from: 'Seros', to: 'Siros' }] }) });
    const response = await app.inject({ method: 'POST', url: '/transcriptions', payload: { audioBase64: Buffer.from('a').toString('base64'), mimeType: 'audio/webm' } });
    expect(response.json()).toEqual({ text: 'email Siros about Kian' });
    expect(seen).toEqual(['Names: Siros.']);
    await app.close();
  });
  it('still transcribes when the dictation help cannot be loaded', async () => {
    const app = Fastify();
    registerTaskRoutes(app, { authenticate: async () => 'alice', plan: async () => ({ reply: '', tasks: [] }), save: async () => {}, transcribe: async (_a, _m, prompt) => `plain ${prompt ?? 'no prompt'}`, dictation: async () => { throw new Error('db down'); } });
    const response = await app.inject({ method: 'POST', url: '/transcriptions', payload: { audioBase64: Buffer.from('a').toString('base64'), mimeType: 'audio/webm' } });
    expect(response.json()).toEqual({ text: 'plain no prompt' });
    await app.close();
  });
});

describe('what dictation shares', () => {
  it('uses the most used entries and never includes another user\'s names', async () => {
    const { db, store } = await setup();
    await learnTerms(db, 'alice', [{ kind: 'person', value: 'Alice Contact' }], 'jira');
    await learnTerms(db, 'bob', [{ kind: 'person', value: 'Bob Contact' }], 'jira');
    expect((await store.dictation('alice')).prompt).toContain('Alice Contact');
    expect((await store.dictation('alice')).prompt).not.toContain('Bob Contact');
    await db.close();
  });
});
