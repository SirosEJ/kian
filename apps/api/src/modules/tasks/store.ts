import { randomUUID } from 'node:crypto';
import type { Queryable } from '@kian/db';
import type { TaskProposal } from '@kian/contracts';
import { snapshotJiraFields } from '../connections/jira-mapping.js';
import { transaction } from '../transaction.js';
import { evaluateTrust, type TrustRule } from '../trust/policy.js';
import { serves } from '../connections/provider-groups.js';

const providerOf = (action: string) => action.startsWith('calendar.') ? 'google_calendar' : action.startsWith('jira.') ? 'jira' : 'ionos';

/**
 * Stores an instruction and its proposals in one transaction. A proposal starts as `queued` only when an active
 * trust rule of this owner matches it exactly; everything else starts as `proposed` and waits for the user.
 */
export async function saveProposals(db: Queryable, ownerId: string, text: string, tasks: TaskProposal[], conversationId: string | null = null): Promise<TaskProposal[]> {
  return transaction(db, client => saveProposalsIn(client, ownerId, text, tasks, conversationId));
}

/** The same, for a caller that already holds a transaction (the conversation service saves messages and proposals together). */
export async function saveProposalsIn(client: Queryable, ownerId: string, text: string, tasks: TaskProposal[], conversationId: string | null = null): Promise<TaskProposal[]> {
  {
    await client.query('INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [ownerId]);
    const rules = (await client.query('SELECT id,owner_id,connection_id,action,constraints,revoked_at FROM trust_rules WHERE owner_id=$1 AND revoked_at IS NULL', [ownerId])).rows
      .map(row => ({ id: row.id, ownerId: row.owner_id, connectionId: row.connection_id, action: row.action, destinations: row.constraints.destinations, revokedAt: row.revoked_at })) as TrustRule[];
    const instructionId = randomUUID();
    await client.query('INSERT INTO instructions (id,owner_id,corrected_text,conversation_id) VALUES ($1,$2,$3,$4)', [instructionId, ownerId, text, conversationId]);
    const connections = (await client.query('SELECT id,provider,settings FROM connections WHERE owner_id=$1 AND disconnected_at IS NULL', [ownerId])).rows;
    const result: TaskProposal[] = [];
    for (const original of tasks) {
      const provider = providerOf(original.action);
      const candidates = connections.filter(c => serves(c.provider, provider) && (!original.connectionId || original.connectionId === c.id));
      const chosen = candidates.length === 1 ? candidates[0] : null;
      const task = { ...original, parameters: provider === 'jira' && chosen ? snapshotJiraFields(original.parameters, chosen.settings) : original.parameters, connectionId: chosen?.id || null, destination: original.destination || chosen?.settings.destination || null };
      const trust = evaluateTrust(ownerId, task, rules);
      const state = trust.allowed ? 'queued' : 'proposed';
      await client.query('INSERT INTO tasks (id,owner_id,instruction_id,action,state,parameters) VALUES ($1,$2,$3,$4,$5,$6)', [task.id, ownerId, instructionId, task.action, state, JSON.stringify({ connectionId: task.connectionId, destination: task.destination, fields: task.parameters, uncertainties: task.uncertainties, trustRuleId: trust.ruleId })]);
      if (trust.allowed) await client.query('INSERT INTO activity(id,owner_id,task_id,event,details) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), ownerId, task.id, 'task.trusted', JSON.stringify({ ruleId: trust.ruleId })]);
      result.push({ ...task, state } as unknown as TaskProposal);
    }
    return result;
  }
}
