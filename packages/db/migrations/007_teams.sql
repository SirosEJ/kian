-- Microsoft sign-in uses PKCE: the one-time verifier is kept with the pending sign-in and is deleted when it is used.
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS code_verifier text;
