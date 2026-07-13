-- Password reset tokens, per-user calendar feed tokens, and email reminder prefs.
-- Apply with: wrangler d1 execute jm-dashboard-db --remote --file=migrations/0002_reset_calendar_reminders.sql

CREATE TABLE IF NOT EXISTS reset_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON reset_tokens(user_id);

ALTER TABLE users ADD COLUMN calendar_token TEXT;
ALTER TABLE users ADD COLUMN reminders INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN tz TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_calendar_token ON users(calendar_token);

-- Client-computed day-by-day schedule (JSON array), pushed alongside the plan on
-- every sync so the calendar feed and reminder emails always match the dashboard.
ALTER TABLE plans ADD COLUMN schedule_json TEXT;
