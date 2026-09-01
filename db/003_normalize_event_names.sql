-- Event names are case-insensitive at the API boundary and canonicalized to lowercase.
-- Normalize existing rows/config so historical data keeps matching key-event queries.

UPDATE events
SET event_type = lower(event_type)
WHERE event_type <> lower(event_type);

UPDATE sites
SET key_events = COALESCE(
  (
    SELECT jsonb_agg(lower(value))
    FROM jsonb_array_elements_text(key_events) AS value
  ),
  '[]'::jsonb
)
WHERE jsonb_typeof(key_events) = 'array';
