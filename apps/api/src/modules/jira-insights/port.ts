import type { Queryable } from '@kian/db';
import { JiraReader } from '@kian/connectors';
import { getJiraConnection, type JiraConfig } from '../connections/jira-routes.js';
import type { JiraLookupPort } from '../conversations/service.js';
import { createInsights, type Reader } from './insights.js';

/**
 * Connects the conversation to the signed-in user's own Jira connection. The user id picks the connection in every query,
 * so one user's question can never run through another user's token. A site must have been chosen in Settings.
 */
export function createJiraLookupPort(db: Queryable, config: JiraConfig, reader: Reader = new JiraReader()): JiraLookupPort {
  const insights = createInsights(reader);
  async function connectionOf(ownerId: string) {
    const row = (await db.query(
      `SELECT id,settings FROM connections WHERE owner_id=$1 AND provider='jira' AND disconnected_at IS NULL AND settings->>'siteId' IS NOT NULL AND settings->>'siteId'<>'' ORDER BY created_at DESC LIMIT 1`, [ownerId])).rows[0];
    return row as { id: string; settings: { destination?: string | null } } | undefined;
  }
  return {
    async info(ownerId) {
      const row = await connectionOf(ownerId);
      return { connected: Boolean(row), defaultProject: row?.settings.destination ?? null };
    },
    async run(ownerId, lookups, today) {
      const row = await connectionOf(ownerId);
      if (!row) return null;
      try {
        const connection = await getJiraConnection(db, ownerId, row.id, config);
        return await insights.run({ ...connection, defaultProject: row.settings.destination ?? null }, lookups, today);
      } catch (error) {
        const message = (error as { statusCode?: number; message?: string }).statusCode === 422 ? String((error as Error).message) : 'Jira could not be reached.';
        return { tables: [], digest: [{ type: 'error', error: message }], issuesRead: 0, notes: [message] };
      }
    },
  };
}
