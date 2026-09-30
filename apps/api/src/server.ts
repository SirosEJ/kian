import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { KianRepository, type Task } from '@kian/db';
import { createRequireUser, requireUser, type VerifyToken } from './modules/identity/session.js';
import { planInstruction } from './modules/tasks/plan.js';
import { registerTaskRoutes, type TaskRoutes } from './modules/tasks/routes.js';
import { registerDecisionRoutes } from './modules/tasks/activity.js';
import { evaluateTrust, type TrustRule } from './modules/trust/policy.js';
import { registerConnectionRoutes } from './modules/connections/routes.js';

type TaskReader = { getTask(ownerId: string, taskId: string): Promise<Task | null> };
type ServerOptions = { verifyToken?: VerifyToken; repository?: TaskReader; taskRoutes?: TaskRoutes };

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });
  app.get('/health', async () => ({ status: 'ok' }));
  const authenticate = options.verifyToken ? createRequireUser(options.verifyToken) : requireUser;
  const pool = !options.repository && process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
  const repository = options.repository ?? (pool ? new KianRepository(pool) : null);

  app.get<{ Params: { id: string } }>('/tasks/:id', async (request, reply) => {
    const ownerId = await authenticate(request);
    if (!repository) return reply.code(503).send({ error: 'Database unavailable' });
    const task = await repository.getTask(ownerId, request.params.id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    return task;
  });
  if (options.taskRoutes) registerTaskRoutes(app, options.taskRoutes);
  else if (pool) registerTaskRoutes(app, {
    authenticate,
    plan: planInstruction,
    save: async (ownerId, text, tasks) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [ownerId]);
        const rules = (await client.query('SELECT id,owner_id,connection_id,action,constraints,revoked_at FROM trust_rules WHERE owner_id=$1 AND revoked_at IS NULL', [ownerId])).rows.map(row => ({ id:row.id, ownerId:row.owner_id, connectionId:row.connection_id, action:row.action, destinations:row.constraints.destinations, revokedAt:row.revoked_at })) as TrustRule[];
        const instructionId = crypto.randomUUID();
        await client.query('INSERT INTO instructions (id,owner_id,corrected_text) VALUES ($1,$2,$3)', [instructionId,ownerId,text]);
        const result = [];
        const connections=(await client.query('SELECT id,provider,settings FROM connections WHERE owner_id=$1 AND disconnected_at IS NULL',[ownerId])).rows;
        for (const original of tasks) {
          const provider=original.action.startsWith('calendar.') ? 'google_calendar' : original.action.startsWith('jira.') ? 'jira' : 'ionos';
          const candidates=connections.filter(c=>c.provider===provider && (!original.connectionId || original.connectionId===c.id));
          const chosen=candidates.length===1 ? candidates[0] : null;
          const task={...original,connectionId:chosen?.id || null,destination:original.destination || chosen?.settings.destination || null};
          const trust = evaluateTrust(ownerId, task, rules);
          const state = trust.allowed ? 'queued' : 'proposed';
          await client.query('INSERT INTO tasks (id,owner_id,instruction_id,action,state,parameters) VALUES ($1,$2,$3,$4,$5,$6)', [task.id,ownerId,instructionId,task.action,state,JSON.stringify({ connectionId: task.connectionId, destination: task.destination, fields: task.parameters, uncertainties: task.uncertainties })]);
          if (trust.allowed) await client.query('INSERT INTO activity(id,owner_id,task_id,event,details) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(),ownerId,task.id,'task.trusted',JSON.stringify({ ruleId:trust.ruleId })]);
          result.push({ ...task, state });
        }
        await client.query('COMMIT');
        return result as typeof tasks;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  });
  if (pool) registerDecisionRoutes(app, pool, authenticate);
  if (pool && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI && process.env.KIAN_ENCRYPTION_KEY) registerConnectionRoutes(app,pool,authenticate,{clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,redirectUri:process.env.GOOGLE_REDIRECT_URI,encryptionKey:Buffer.from(process.env.KIAN_ENCRYPTION_KEY,'base64')});
  app.addHook('onClose', async () => { if (pool) await pool.end(); });
  return app;
}

if (process.env.NODE_ENV !== 'test' && process.argv[1]?.endsWith('/server.js')) {
  const app = buildServer();
  const port = Number(process.env.PORT || 8080);
  app.listen({ host: '0.0.0.0', port }).catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });
}
