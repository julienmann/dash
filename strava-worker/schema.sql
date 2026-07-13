CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  calendar_token TEXT,
  reminders INTEGER NOT NULL DEFAULT 0,
  tz TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_calendar_token ON users(calendar_token);

CREATE TABLE IF NOT EXISTS plans (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  plan_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Client-computed day-by-day schedule (JSON array), pushed alongside the plan on
  -- every sync so the calendar feed and reminder emails always match the dashboard.
  schedule_json TEXT
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verification_tokens_user ON verification_tokens(user_id);

CREATE TABLE IF NOT EXISTS reset_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON reset_tokens(user_id);
