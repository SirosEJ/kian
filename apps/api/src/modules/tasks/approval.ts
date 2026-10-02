import { snapshotJiraFields } from '../connections/jira-mapping.js';
import { randomUUID } from 'node:crypto';
import type { Queryable, Task } from '@kian/db';
import { isPool } from '../transaction.js';
import { evaluateTrust } from '../trust/policy.js';

const failure = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
export type StoredProposal = { connectionId: string | null; destination: string | null; fields: Record<string, unknown>; uncertainties: string[] };

const blank = (value: unknown) => typeof value !== 'string' || !value.trim();
/** The details a task cannot run without, in the words the user sees on screen. */
export function missingDetails(action: string, fields: Record<string, unknown> | undefined): string[] {
  const f = fields ?? {};
  const missing: string[] = [];
  if (action === 'email.send') {
    if (!Array.isArray(f.to) || f.to.length === 0) missing.push('recipient');
    if (blank(f.subject)) missing.push('subject');
    if (blank(f.body)) missing.push('message');
  } else if (action === 'calendar.create') {
    if (blank(f.summary)) missing.push('title');
    if (blank(f.start)) missing.push('start time');
    if (blank(f.end)) missing.push('end time');
  } else if (action === 'jira.create') {
    if (blank(f.summary)) missing.push('title');
  } else if (action === 'jira.transition') {
    if (blank(f.issueKey)) missing.push('issue');
    if (blank(f.toStatus)) missing.push('new status');
  }
  return missing;
}

export function createApprovalService(db: Queryable) {
  return {
    async decideTask(ownerId: string, taskId: string, version: number, decision: 'approve' | 'reject', optionalRule?: { connectionId:string; action:string; destinations:string[] }): Promise<Task> {
      if (isPool(db)) {
        const client = await db.connect();
        try { await client.query('BEGIN'); const result = await createApprovalService(client).decideTask(ownerId,taskId,version,decision,optionalRule); await client.query('COMMIT'); return result; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      }
      if (optionalRule && decision !== 'approve') throw failure(422, 'Trust can only follow approval');
      if (optionalRule) {
        const current = await db.query('SELECT action,parameters,version,state FROM tasks WHERE owner_id=$1 AND id=$2', [ownerId,taskId]);
        if (!current.rows.length) throw failure(404, 'Task not found');
        const { action, parameters, version: currentVersion, state } = current.rows[0] as {action:string;parameters:StoredProposal;version:number;state:string};
        if (currentVersion !== version || state !== 'proposed') throw failure(409, 'Task changed or was already decided');
        if (optionalRule.connectionId !== parameters.connectionId || optionalRule.action !== action || !parameters.destination || optionalRule.destinations.length !== 1 || optionalRule.destinations[0] !== parameters.destination ||
          !evaluateTrust(ownerId, { action, connectionId:parameters.connectionId, destination:parameters.destination, parameters:parameters.fields, uncertainties:parameters.uncertainties }, [{ id:'candidate', ownerId, ...optionalRule, revokedAt:null }]).allowed) throw failure(422, 'Trust scope must match this task');
        const connection = await db.query('SELECT id FROM connections WHERE owner_id=$1 AND id=$2 AND disconnected_at IS NULL', [ownerId,optionalRule.connectionId]);
        if (!connection.rows.length) throw failure(422, 'Connect a service before trusting it');
      }
      if (decision === 'approve') {
        const row = (await db.query('SELECT action,parameters,version,state FROM tasks WHERE owner_id=$1 AND id=$2', [ownerId,taskId])).rows[0] as {action:string;parameters:StoredProposal;version:number;state:string} | undefined;
        if (row && row.version === version && row.state === 'proposed') {
          const missing = missingDetails(row.action, row.parameters.fields);
          if (missing.length) throw failure(422, `Add the missing ${missing.join(' and ')} before approving.`);
        }
      }
      const state = decision === 'approve' ? 'queued' : 'rejected';
      const result = await db.query('UPDATE tasks SET state=$4,version=version+1,parameters=parameters - \'trustRuleId\' WHERE owner_id=$1 AND id=$2 AND version=$3 AND state=$5 AND ( $4=$6 OR jsonb_array_length(COALESCE(parameters->\'uncertainties\',\'[]\'::jsonb))=0 ) RETURNING id,owner_id,action,state,parameters,version', [ownerId,taskId,version,state,'proposed','rejected']);
      const task = result.rows[0] as Task | undefined;
      if (!task) {
        const exists = await db.query('SELECT version,state FROM tasks WHERE owner_id=$1 AND id=$2', [ownerId,taskId]);
        if (!exists.rows.length) throw failure(404, 'Task not found');
        if (decision === 'approve' && exists.rows[0].version === version && exists.rows[0].state === 'proposed') throw failure(422, 'Clarification required');
        throw failure(409, 'Task changed or was already decided');
      }
      await db.query('INSERT INTO activity(id,owner_id,task_id,event,details) VALUES ($1,$2,$3,$4,$5)', [randomUUID(),ownerId,taskId,decision === 'approve' ? 'task.approved' : 'task.rejected',JSON.stringify({ version })]);
      if (optionalRule && decision === 'approve') {
        await db.query('INSERT INTO trust_rules(id,owner_id,connection_id,action,constraints) VALUES ($1,$2,$3,$4,$5)', [randomUUID(),ownerId,optionalRule.connectionId,optionalRule.action,JSON.stringify({ destinations: optionalRule.destinations })]);
      }
      return task;
    },
    async editTask(ownerId: string, taskId: string, version: number, proposal: StoredProposal): Promise<Task> {
      if (isPool(db)) {
        const client = await db.connect();
        try { await client.query('BEGIN'); const result = await createApprovalService(client).editTask(ownerId,taskId,version,proposal); await client.query('COMMIT'); return result; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      }
      if(proposal.connectionId) {
        const connection=(await db.query('SELECT provider,settings FROM connections WHERE owner_id=$1 AND id=$2 AND disconnected_at IS NULL',[ownerId,proposal.connectionId])).rows[0];
        if(connection?.provider==='jira') proposal={...proposal,fields:snapshotJiraFields(proposal.fields,connection.settings)};
      }
      const result = await db.query("UPDATE tasks SET state='proposed',parameters=$4,version=version+1 WHERE owner_id=$1 AND id=$2 AND version=$3 AND state='proposed' RETURNING id,owner_id,action,state,parameters,version", [ownerId,taskId,version,JSON.stringify(proposal)]);
      const task = result.rows[0] as Task | undefined;
      if (!task) throw failure(409, 'Task changed or inaccessible');
      await db.query('INSERT INTO activity(id,owner_id,task_id,event,details) VALUES ($1,$2,$3,$4,$5)', [randomUUID(),ownerId,taskId,'task.edited',JSON.stringify({ version:task.version })]);
      return task;
    },
    async listActivity(ownerId: string) {
      // The task is joined by owner as well, so a task id can never pull in another user's data.
      const result = await db.query(`SELECT a.id,a.task_id,a.event,a.details,a.created_at,t.action,t.parameters->>'destination' AS destination
        FROM activity a LEFT JOIN tasks t ON t.id=a.task_id AND t.owner_id=a.owner_id
        WHERE a.owner_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 200`, [ownerId]);
      return result.rows as { id:string; task_id:string; event:string; details:unknown; created_at:Date; action:string|null; destination:string|null }[];
    },
    async listRules(ownerId: string) {
      return (await db.query(`SELECT r.id,r.connection_id,r.action,r.constraints,r.revoked_at,r.created_at,c.display_name AS connection_name
        FROM trust_rules r LEFT JOIN connections c ON c.id=r.connection_id AND c.owner_id=r.owner_id
        WHERE r.owner_id=$1 ORDER BY r.created_at DESC`, [ownerId])).rows;
    },
    async revokeRule(ownerId: string, id: string) {
      const result = await db.query('UPDATE trust_rules SET revoked_at=now() WHERE owner_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING id', [ownerId,id]);
      if (!result.rows.length) throw failure(404, 'Rule not found');
    },
  };
}
