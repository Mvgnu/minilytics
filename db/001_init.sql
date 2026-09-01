CREATE TABLE IF NOT EXISTS sites (
  id text PRIMARY KEY,
  name text NOT NULL,
  domain text NOT NULL,
  secret_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  visitor_id text,
  event_type text NOT NULL,
  path text NOT NULL,
  title text,
  landing_path text,
  landing_referrer text,
  source text NOT NULL,
  medium text NOT NULL,
  source_detail text,
  target_url text,
  target_label text,
  device_type text,
  country text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_site_time_idx
  ON events (site_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS events_site_path_time_idx
  ON events (site_id, path, occurred_at DESC);

CREATE INDEX IF NOT EXISTS events_site_session_time_idx
  ON events (site_id, session_id, occurred_at ASC);

CREATE INDEX IF NOT EXISTS events_site_source_time_idx
  ON events (site_id, source, occurred_at DESC);
