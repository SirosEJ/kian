import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MEMORY_KINDS, MEMORY_LIMITS, type MemoryStore } from './store.js';

const text = (max: number) => z.string().max(max * 2);
const NewTerm = z.object({ kind: z.enum(MEMORY_KINDS), value: text(MEMORY_LIMITS.value), alias: text(MEMORY_LIMITS.alias).nullish(), detail: text(MEMORY_LIMITS.detail).nullish() });
const Patch = z.object({ value: text(MEMORY_LIMITS.value), alias: text(MEMORY_LIMITS.alias).nullish(), detail: text(MEMORY_LIMITS.detail).nullish() });

/** "What Kian remembers": the signed-in user lists, adds, edits and deletes their own entries, and switches learning off. */
export function registerMemoryRoutes(app: FastifyInstance, memory: MemoryStore, authenticate: (request: { headers: { authorization?: string } }) => Promise<string>) {
  app.get('/memory', async request => memory.view(await authenticate(request)));
  app.put<{ Body: { enabled?: unknown } }>('/memory/enabled', async (request, reply) => {
    const owner = await authenticate(request);
    if (typeof request.body?.enabled !== 'boolean') return reply.code(400).send({ error: 'Say whether learning is on or off.' });
    await memory.setEnabled(owner, request.body.enabled);
    return { enabled: request.body.enabled };
  });
  app.post('/memory', async (request, reply) => {
    const owner = await authenticate(request);
    const parsed = NewTerm.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Check the kind and the name.' });
    const term = await memory.add(owner, parsed.data);
    return term ? reply.code(201).send(term) : reply.code(400).send({ error: 'The name cannot be empty.' });
  });
  app.put<{ Params: { id: string } }>('/memory/:id', async (request, reply) => {
    const owner = await authenticate(request);
    const parsed = Patch.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Check the name.' });
    const term = await memory.update(owner, request.params.id, parsed.data);
    return term ?? reply.code(404).send({ error: 'Not found, or another entry already has that name.' });
  });
  app.delete<{ Params: { id: string } }>('/memory/:id', async (request, reply) => {
    const owner = await authenticate(request);
    return (await memory.remove(owner, request.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: 'Not found' });
  });
  app.delete('/memory', async request => ({ deleted: await memory.clear(await authenticate(request)) }));
}
