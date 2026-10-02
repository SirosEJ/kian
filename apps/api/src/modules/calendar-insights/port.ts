import type { Queryable } from '@kian/db';
import { GoogleCalendarReader } from '@kian/connectors';
import { getGoogleAccessToken, type GoogleConfig } from '../connections/routes.js';
import type { CalendarLookupPort } from '../conversations/service.js';
import { createCalendarInsights, type CalendarReader } from './insights.js';

/**
 * Connects the conversation to the signed-in user's own Google Calendar connection. The user id picks the connection in every
 * query, so one user's question can never run through another user's token. Reads use the calendar chosen in Settings (or the primary one).
 */
export function createCalendarLookupPort(db: Queryable, config: GoogleConfig, reader: CalendarReader = new GoogleCalendarReader()): CalendarLookupPort {
  const insights = createCalendarInsights(reader);
  async function connectionOf(ownerId: string) {
    const row = (await db.query(`SELECT id,settings FROM connections WHERE owner_id=$1 AND provider='google_calendar' AND disconnected_at IS NULL ORDER BY created_at DESC LIMIT 1`, [ownerId])).rows[0];
    return row as { id: string; settings: { destination?: string | null } } | undefined;
  }
  return {
    async info(ownerId) { return { connected: Boolean(await connectionOf(ownerId)) }; },
    async run(ownerId, lookups, ctx) {
      const row = await connectionOf(ownerId);
      if (!row) return null;
      try {
        const accessToken = await getGoogleAccessToken(db, ownerId, row.id, config);
        return await insights.run({ accessToken, calendarId: row.settings.destination || 'primary' }, lookups, ctx);
      } catch (error) {
        const message = (error as { statusCode?: number }).statusCode === 422 ? String((error as Error).message) : 'Google Calendar could not be reached.';
        return { tables: [], digest: [{ type: 'error', error: message }], issuesRead: 0, notes: [message] };
      }
    },
  };
}
