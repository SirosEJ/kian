-- SFT-274: an assistant message can carry result tables (Jira lookups and reports), built by the server from Jira's own answer.
ALTER TABLE messages ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]';
