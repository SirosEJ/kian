import type { FastifyInstance } from 'fastify';
import { createApprovalService, type StoredProposal } from './approval.js';
import type { Queryable } from '@kian/db';

export function registerDecisionRoutes(app: FastifyInstance, db: Queryable, authenticate: (request: { headers: { authorization?: string } }) => Promise<string>) {
  const service = createApprovalService(db);
  app.post<{Params:{id:string};Body:{version:number;decision:'approve'|'reject';trust?:{connectionId:string;action:string;destinations:string[]}}}>('/tasks/:id/decision', async (request, reply) => {
    const owner = await authenticate(request);
    const { version, decision, trust } = request.body || {} as never;
    if (!Number.isSafeInteger(version) || version < 1 || !['approve','reject'].includes(decision) || (trust && (typeof trust.connectionId !== 'string' || typeof trust.action !== 'string' || !Array.isArray(trust.destinations)))) return reply.code(400).send({ error:'Invalid decision' });
    return service.decideTask(owner, request.params.id, version, decision, trust);
  });
  app.patch<{Params:{id:string};Body:{version:number;proposal:StoredProposal}}>('/tasks/:id', async (request, reply) => {
    const owner = await authenticate(request);
    const { version, proposal } = request.body || {} as never;
    if (!Number.isSafeInteger(version) || version < 1 || !proposal || typeof proposal.destination !== 'string' || !Array.isArray(proposal.uncertainties) || typeof proposal.fields !== 'object') return reply.code(400).send({ error:'Invalid proposal' });
    return service.editTask(owner, request.params.id, version, proposal);
  });
  app.get('/activity', async request => service.listActivity(await authenticate(request)));
  app.get('/trust-rules', async request => service.listRules(await authenticate(request)));
  app.delete<{Params:{id:string}}>('/trust-rules/:id', async (request, reply) => {
    await service.revokeRule(await authenticate(request), request.params.id);
    return reply.code(204).send();
  });
}
