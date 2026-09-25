-- Lookup keys rotate every 30 minutes and expire after 30 minutes of inactivity.
-- Raw addresses / user agents are never written to the analytics database.
CREATE TABLE IF NOT EXISTS analytics_network_sessions (
  site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  match_key text NOT NULL,
  session_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (site_id, match_key)
);
CREATE INDEX IF NOT EXISTS analytics_network_sessions_expiry_idx ON analytics_network_sessions (expires_at);
