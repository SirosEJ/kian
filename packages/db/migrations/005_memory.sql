-- SFT-280: what Kian remembers for one user (names, projects, epics, calendars, spoken-form corrections).
-- Per user, deleted with the account, never shared. Not copied from email bodies or event descriptions.
ALTER TABLE users ADD COLUMN memory_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE memory_terms (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('person','project','epic','calendar','meeting','correction')),
  value text NOT NULL,
  alias text,
  detail text,
  source text NOT NULL CHECK (source IN ('jira','calendar','email','chat','manual')),
  uses integer NOT NULL DEFAULT 0,
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX memory_terms_unique ON memory_terms (owner_id, kind, lower(value));
CREATE INDEX memory_terms_owner ON memory_terms (owner_id);
