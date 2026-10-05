import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { KianRepository, type Task } from '@kian/db';
import { createRequireUser, requireUser, type VerifyToken } from './modules/identity/session.js';
import { planInstruction } from './modules/tasks/plan.js';
import { registerTaskRoutes, type TaskRoutes } from './modules/tasks/routes.js';
import { createConversationService } from './modules/conversations/service.js';
import { createJiraLookupPort } from './modules/jira-insights/port.js';
import { createMemoryStore } from './modules/memory/store.js';
import { registerPersonaRoutes } from './modules/persona/routes.js';
import { registerMemoryRoutes } from './modules/memory/routes.js';
import { createCalendarLookupPort } from './modules/calendar-insights/port.js';
import { saveProposals } from './modules/tasks/store.js';
import { registerDecisionRoutes } from './modules/tasks/activity.js';
import { registerConnectionRoutes } from './modules/connections/routes.js';
import { registerJiraConnectionRoutes } from './modules/connections/jira-routes.js';
import { registerTeamsConnectionRoutes } from './modules/connections/teams-routes.js';
import { registerMailConnectionRoutes } from './modules/connections/mail-routes.js';
import { registerAccountRoutes } from './modules/identity/account.js';
import { createRunner } from './modules/execution/runner.js';
import { createProviderExecutor } from './modules/execution/providers.js';

type TaskReader = { getTask(ownerId: string, taskId: string): Promise<Task | null> };
type ServerOptions = { webDistPath?:string; verifyToken?: VerifyToken; repository?: TaskReader; taskRoutes?: TaskRoutes };

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });
  const webDistPath=options.webDistPath || process.env.WEB_DIST_PATH;
  if(webDistPath) {
    app.register(fastifyStatic,{root:join(webDistPath,'assets'),prefix:'/assets/',wildcard:true});
    app.get('/',async(_request,reply)=>reply.sendFile('index.html',webDistPath));
    // Pages the web app routes on the client. A browser load (Accept: text/html) gets the app; the app's own
    // requests (Accept: */*, e.g. GET /activity) still reach the JSON API.
    const clientPages=new Set(['/activity','/settings','/account']);
    app.addHook('onRequest',async(request,reply)=>{
      if(request.method!=='GET' || !(request.headers.accept || '').includes('text/html')) return;
      const path=request.url.split('?')[0].replace(/\/+$/,'');
      if(clientPages.has(path)) return reply.sendFile('index.html',webDistPath);
    });
  }
  app.get('/health', async () => ({ status: 'ok' }));
  const authenticate = options.verifyToken ? createRequireUser(options.verifyToken) : requireUser;
  const pool = !options.repository && process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
  const repository = options.repository ?? (pool ? new KianRepository(pool) : null);
  const encryptionKey=process.env.KIAN_ENCRYPTION_KEY ? Buffer.from(process.env.KIAN_ENCRYPTION_KEY,'base64'):null;
  const google=process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI && encryptionKey ? {clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,redirectUri:process.env.GOOGLE_REDIRECT_URI,encryptionKey}:undefined;
  const jira=process.env.JIRA_CLIENT_ID && process.env.JIRA_CLIENT_SECRET && process.env.JIRA_REDIRECT_URI && encryptionKey ? {clientId:process.env.JIRA_CLIENT_ID,clientSecret:process.env.JIRA_CLIENT_SECRET,redirectUri:process.env.JIRA_REDIRECT_URI,encryptionKey}:undefined;
  const runner=pool && encryptionKey ? createRunner(pool,createProviderExecutor(pool,encryptionKey,google,jira),true):null;
  app.get('/tasks',async(request,reply)=>{
    const owner=await authenticate(request);
    if(!pool) return reply.code(503).send({error:'Database unavailable'});
    return (await pool.query('SELECT id,action,state,parameters,version FROM tasks WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100',[owner])).rows.map(t=>({id:t.id,action:t.action,state:t.state,version:t.version,connectionId:t.parameters.connectionId,destination:t.parameters.destination,parameters:t.parameters.fields,uncertainties:t.parameters.uncertainties}));
  });

  app.get<{ Params: { id: string } }>('/tasks/:id', async (request, reply) => {
    const ownerId = await authenticate(request);
    if (!repository) return reply.code(503).send({ error: 'Database unavailable' });
    const task = await repository.getTask(ownerId, request.params.id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    return task;
  });
  if (options.taskRoutes) registerTaskRoutes(app, options.taskRoutes);
  else if (pool) {
    const conversations = createConversationService(pool, planInstruction, jira ? createJiraLookupPort(pool, jira) : undefined, google ? createCalendarLookupPort(pool, google) : undefined, createMemoryStore(pool));
    registerTaskRoutes(app, {
      authenticate,
      plan: planInstruction,
      save: (ownerId, text, tasks) => saveProposals(pool, ownerId, text, tasks),
      converse: conversations.converse,
      conversations,
      dictation: async ownerId => { const { prompt, corrections } = await createMemoryStore(pool).dictation(ownerId); return { prompt, corrections }; },
    });
  }
  registerPersonaRoutes(app,authenticate);
  if (pool) registerAccountRoutes(app,pool,authenticate);
  if (pool) registerMemoryRoutes(app,createMemoryStore(pool),authenticate);
  if (pool) registerDecisionRoutes(app, pool, authenticate,runner ? (owner,id)=>runner.run(owner,id):undefined);
  if (pool && process.env.KIAN_ENCRYPTION_KEY) registerConnectionRoutes(app,pool,authenticate,{clientId:process.env.GOOGLE_CLIENT_ID || '',clientSecret:process.env.GOOGLE_CLIENT_SECRET || '',redirectUri:process.env.GOOGLE_REDIRECT_URI || '',encryptionKey:Buffer.from(process.env.KIAN_ENCRYPTION_KEY,'base64')});
  if (pool && process.env.JIRA_CLIENT_ID && process.env.JIRA_CLIENT_SECRET && process.env.JIRA_REDIRECT_URI && process.env.KIAN_ENCRYPTION_KEY) registerJiraConnectionRoutes(app,pool,authenticate,{clientId:process.env.JIRA_CLIENT_ID,clientSecret:process.env.JIRA_CLIENT_SECRET,redirectUri:process.env.JIRA_REDIRECT_URI,encryptionKey:Buffer.from(process.env.KIAN_ENCRYPTION_KEY,'base64')});
  if (pool && process.env.TEAMS_CLIENT_ID && process.env.TEAMS_CLIENT_SECRET && process.env.TEAMS_REDIRECT_URI && process.env.KIAN_ENCRYPTION_KEY) registerTeamsConnectionRoutes(app,pool,authenticate,{clientId:process.env.TEAMS_CLIENT_ID,clientSecret:process.env.TEAMS_CLIENT_SECRET,redirectUri:process.env.TEAMS_REDIRECT_URI,tenant:process.env.TEAMS_TENANT || 'organizations',encryptionKey:Buffer.from(process.env.KIAN_ENCRYPTION_KEY,'base64')});
  if(pool && encryptionKey) registerMailConnectionRoutes(app,pool,authenticate,encryptionKey);
  if(runner && pool) {
    let timer:ReturnType<typeof setInterval>|undefined;
    let draining=false;
    const drain=async()=>{
      if(draining) return;
      draining=true;
      try {
        await runner.recoverInterrupted();
        const pending=await pool.query("SELECT owner_id,id FROM tasks WHERE state='queued' ORDER BY created_at LIMIT 20");
        for(const task of pending.rows) await runner.run(task.owner_id,task.id);
      } catch(error) {app.log.error({error},'Task worker failed');}
      finally {draining=false;}
    };
    app.addHook('onListen',async()=>{timer=setInterval(()=>void drain(),15000);timer.unref();void drain();});
    app.addHook('onClose',async()=>{if(timer) clearInterval(timer);});
  }
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
