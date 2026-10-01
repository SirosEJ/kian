-- SFT-253: Kian keeps a conversation per user. Everything cascades with the account.
CREATE TABLE conversations (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_owner ON conversations(owner_id, created_at DESC);

CREATE TABLE messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX messages_owner_recent ON messages(owner_id, created_at DESC);

ALTER TABLE instructions ADD COLUMN conversation_id text REFERENCES conversations(id) ON DELETE SET NULL;
CREATE INDEX instructions_conversation ON instructions(conversation_id);

-- A proposal the user never decided on can be superseded by a later message in the same conversation.
ALTER TABLE tasks DROP CONSTRAINT tasks_state_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_state_check CHECK (state IN ('proposed','approved','rejected','queued','executing','succeeded','failed','uncertain','replaced'));
