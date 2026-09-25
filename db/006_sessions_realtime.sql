-- Persist first-touch attribution independently of document/runtime lifetime.
CREATE TABLE IF NOT EXISTS analytics_sessions (
  site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  attribution jsonb NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, session_id)
);
CREATE INDEX IF NOT EXISTS analytics_sessions_last_seen_idx ON analytics_sessions (last_seen_at);
CREATE INDEX IF NOT EXISTS events_site_received_idx ON events (site_id, received_at DESC);
CREATE INDEX IF NOT EXISTS events_site_visitor_key_time_idx
  ON events (site_id, (COALESCE(visitor_id, session_id)), occurred_at, id);
