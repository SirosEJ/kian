-- SFT-254: an assistant message remembers the tasks it prepared, so the chat can show each card under its reply.
ALTER TABLE messages ADD COLUMN task_ids jsonb NOT NULL DEFAULT '[]';
