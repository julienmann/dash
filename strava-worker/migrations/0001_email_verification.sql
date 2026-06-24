-- Adds email confirmation to an already-deployed DB (schema.sql already has these for fresh installs).
-- Run with: wrangler d1 execute jm-dashboard-db --remote --file=migrations/0001_email_verification.sql
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS verification_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verification_tokens_user ON verification_tokens(user_id);
