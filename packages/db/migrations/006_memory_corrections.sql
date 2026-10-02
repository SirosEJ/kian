-- SFT-281: how often the user changed the same spoken word into the same written word after dictating.
-- A correction is learned only when the same change is seen in two separate messages; a one-off edit is not.
CREATE TABLE memory_corrections_seen (
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spoken text NOT NULL,
  written text NOT NULL,
  seen integer NOT NULL DEFAULT 1,
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, spoken, written)
);
