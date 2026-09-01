ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS key_events jsonb NOT NULL DEFAULT '["outbound"]'::jsonb;

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS funnels jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS events_site_visitor_time_idx
  ON events (site_id, visitor_id, occurred_at ASC)
  WHERE visitor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_site_event_time_idx
  ON events (site_id, event_type, occurred_at DESC);
