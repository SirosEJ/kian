import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { validPhoto } from './persona.js';

const DIR = new URL('../../../assets/persona/', import.meta.url);

/** Kian's photos, only for signed-in users (they are not part of the public web files). */
export function registerPersonaRoutes(app: FastifyInstance, authenticate: (request: { headers: { authorization?: string } }) => Promise<string>, dir: URL = DIR) {
  app.get<{ Params: { id: string } }>('/persona/photos/:id', async (request, reply) => {
    await authenticate(request);
    if (!validPhoto(request.params.id)) return reply.code(404).send({ error: 'Not found' });
    try {
      const file = await readFile(new URL(`${request.params.id}.jpg`, dir));
      return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=86400').send(file);
    } catch { return reply.code(404).send({ error: 'Not found' }); }
  });
}
