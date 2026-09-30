import type { FastifyInstance } from 'fastify';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Queryable } from '@kian/db';

export type DeleteIdentity = (uid: string) => Promise<void>;

export const deleteFirebaseIdentity: DeleteIdentity = async uid => {
  if (!getApps().length) initializeApp();
  await getAuth().deleteUser(uid);
};

export function registerAccountRoutes(app: FastifyInstance, db: Queryable, authenticate: (request: { headers: { authorization?: string } }) => Promise<string>, deleteIdentity: DeleteIdentity = deleteFirebaseIdentity) {
  app.delete<{ Body: { confirm?: string } }>('/account', async (request, reply) => {
    const owner = await authenticate(request);
    if (request.body?.confirm !== 'DELETE') return reply.code(400).send({ error: 'Confirm account deletion' });
    await db.query('DELETE FROM users WHERE id=$1', [owner]);
    try { await deleteIdentity(owner); }
    catch { return reply.code(502).send({ error: 'Your Kian data was deleted but sign-in removal failed. Retry to finish.' }); }
    return reply.code(204).send();
  });
}
