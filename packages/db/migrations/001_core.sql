CREATE TABLE users (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE connections (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  display_name text NOT NULL,
  secret_ciphertext bytea,
  settings jsonb NOT NULL DEFAULT '{}',
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX connections_owner ON connections(owner_id);

CREATE TABLE oauth_states (
  state text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE instructions (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  corrected_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX instructions_owner ON instructions(owner_id);

CREATE TABLE tasks (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL,
  state text NOT NULL CHECK (state IN ('proposed','approved','rejected','queued','executing','succeeded','failed','uncertain')),
  parameters jsonb NOT NULL,
  instruction_id text REFERENCES instructions(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_owner ON tasks(owner_id);

CREATE TABLE trust_rules (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id text NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  action text NOT NULL,
  constraints jsonb NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trust_rules_owner ON trust_rules(owner_id);

CREATE TABLE activity (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id text REFERENCES tasks(id) ON DELETE SET NULL,
  event text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_owner ON activity(owner_id);

CREATE TABLE executions (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed','uncertain')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (task_id,task_version)
);
