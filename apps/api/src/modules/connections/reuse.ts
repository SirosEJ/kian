import { randomUUID } from 'node:crypto';
import type { Queryable } from '@kian/db';

type Existing = { id: string; settings: Record<string, unknown> };
export type ReuseSpec = {
  owner: string;
  /** Connection providers that count as the same kind of connection (email is both `ionos` and `mailbox`). */
  providers: string[];
  /** The provider name and settings for a brand-new connection. */
  provider: string; displayName: string; ciphertext: Buffer; settings: Record<string, unknown>;
  /** Only connections whose setting `key` equals `value` (case-insensitive) are the same account, for example a mailbox address. */
  sameAccount?: { key: string; value: string };
  /** Settings to change on a connection that is reused; everything else (chosen calendar, site, project) is kept. */
  refresh?: Record<string, unknown>;
};

/** Stop trusting what was done through these connections and forget their credentials: what Disconnect does. */
export async function disconnectConnections(db: Queryable, owner: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.query('UPDATE connections SET secret_ciphertext=NULL,disconnected_at=now() WHERE owner_id=$1 AND id=ANY($2::text[]) AND disconnected_at IS NULL', [owner, ids]);
  await db.query('UPDATE trust_rules SET revoked_at=now() WHERE owner_id=$1 AND connection_id=ANY($2::text[]) AND revoked_at IS NULL', [owner, ids]);
}

/**
 * Connecting the same account again refreshes the connection it already has (same id, same chosen calendar or project, same
 * trusted actions) instead of adding a second entry. Duplicates that already exist are disconnected, keeping the one with
 * trusted actions, then the one with a chosen calendar or project, then the one with a Jira site, then the newest.
 */
export async function reuseOrCreateConnection(db: Queryable, spec: ReuseSpec): Promise<{ id: string; reused: boolean }> {
  const found = (await db.query(
    `SELECT c.id, c.settings FROM connections c
     WHERE c.owner_id=$1 AND c.provider=ANY($2::text[]) AND c.disconnected_at IS NULL
       AND ($3::text IS NULL OR lower(c.settings->>$3)=lower($4))
     ORDER BY EXISTS(SELECT 1 FROM trust_rules t WHERE t.connection_id=c.id AND t.owner_id=c.owner_id AND t.revoked_at IS NULL) DESC,
              (COALESCE(c.settings->>'destination','')<>'') DESC, (COALESCE(c.settings->>'siteId','')<>'') DESC, c.created_at DESC`,
    [spec.owner, spec.providers, spec.sameAccount?.key ?? null, spec.sameAccount?.value ?? ''])).rows as Existing[];
  if (found.length) {
    const keep = found[0];
    await db.query('UPDATE connections SET secret_ciphertext=$3,display_name=$4,settings=settings || $5::jsonb WHERE owner_id=$1 AND id=$2', [spec.owner, keep.id, spec.ciphertext, spec.displayName, JSON.stringify(spec.refresh ?? {})]);
    await disconnectConnections(db, spec.owner, found.slice(1).map(row => row.id));
    return { id: keep.id, reused: true };
  }
  const id = randomUUID();
  await db.query('INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext,settings) VALUES ($1,$2,$3,$4,$5,$6)', [id, spec.owner, spec.provider, spec.displayName, spec.ciphertext, JSON.stringify(spec.settings)]);
  return { id, reused: false };
}
