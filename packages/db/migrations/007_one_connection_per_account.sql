-- Connecting the same account again used to add a second connection (Settings showed Google Calendar and mailboxes twice).
-- Keep one per account and disconnect the rest, exactly as Disconnect does (credentials forgotten, trusted actions on them revoked).
-- Which one is kept: the one with active trusted actions, then the one with a chosen calendar or Jira project, then the one with a Jira site, then the newest.
-- Same account means: Google Calendar one per person; email one per mailbox address; Jira one per site (connections with no site chosen count as one).
CREATE TEMP TABLE duplicate_connections ON COMMIT DROP AS
SELECT id, owner_id FROM (
  SELECT c.id, c.owner_id,
    ROW_NUMBER() OVER (
      PARTITION BY c.owner_id,
        CASE WHEN c.provider IN ('ionos','mailbox') THEN 'mail:' || lower(COALESCE(c.settings->>'mailbox', c.display_name))
             WHEN c.provider = 'jira' THEN 'jira:' || COALESCE(c.settings->>'siteId','')
             ELSE c.provider END
      ORDER BY EXISTS (SELECT 1 FROM trust_rules t WHERE t.connection_id = c.id AND t.owner_id = c.owner_id AND t.revoked_at IS NULL) DESC,
               (COALESCE(c.settings->>'destination', '') <> '') DESC,
               (COALESCE(c.settings->>'siteId', '') <> '') DESC,
               c.created_at DESC, c.id DESC
    ) AS keep_rank
  FROM connections c
  WHERE c.disconnected_at IS NULL AND c.provider IN ('google_calendar','jira','ionos','mailbox')
) ranked WHERE keep_rank > 1;

UPDATE trust_rules SET revoked_at = now()
WHERE revoked_at IS NULL AND connection_id IN (SELECT id FROM duplicate_connections);

UPDATE connections SET secret_ciphertext = NULL, disconnected_at = now()
WHERE id IN (SELECT id FROM duplicate_connections) AND disconnected_at IS NULL;
