import postgres from "postgres";
let client: postgres.Sql | undefined;
function realtimeDb() {
  return client ??= postgres(process.env.DATABASE_URL!, { max: 2, idle_timeout: 20,
    connection: {application_name: "minilytics-realtime", statement_timeout: 5000} });
}
import { cachedReport } from "./report-cache";

export type RealtimeData = {
  users: number;
  pageviews: number;
  updatedAt: string;
  minutes: Array<{ minute: string; users: number }>;
  rows: Array<{ source: string; medium: string; path: string; users: number }>;
};

export function getRealtime(siteId: string): Promise<RealtimeData | null> {
  return cachedReport(`realtime:${siteId}`, async () => {
    const sql = realtimeDb();
    const [site] = await sql`SELECT id FROM sites WHERE id = ${siteId}`;
    if (!site) return null;
    const [result] = await sql<{data: RealtimeData}[]>`
      WITH recent AS MATERIALIZED (
        SELECT id, COALESCE(visitor_id, session_id) AS visitor, event_type, path,
          COALESCE(NULLIF(source_detail, ''), NULLIF(source, ''), '(direct)') AS source,
          CASE WHEN medium = 'direct' THEN '(none)' WHEN medium = 'search' THEN 'organic' ELSE medium END AS medium,
          received_at
        FROM events WHERE site_id = ${siteId}
          AND received_at >= now() - interval '30 minutes' AND received_at <= now()
      ), active AS (
        SELECT DISTINCT ON (visitor) visitor, source, medium, path
        FROM recent ORDER BY visitor, received_at DESC, id DESC
      ), breakdown AS (
        SELECT source, medium, path, COUNT(*)::int AS users
        FROM active GROUP BY source, medium, path ORDER BY users DESC, source, medium, path LIMIT 50
      ), minutes AS (
        SELECT date_trunc('minute', received_at) AS minute, COUNT(DISTINCT visitor)::int AS users
        FROM recent GROUP BY 1 ORDER BY 1
      )
      SELECT jsonb_build_object(
        'users', (SELECT COUNT(*) FROM active),
        'pageviews', (SELECT COUNT(*) FROM recent WHERE event_type = 'pageview'),
        'updatedAt', now(),
        'rows', COALESCE((SELECT jsonb_agg(b) FROM breakdown b), '[]'::jsonb),
        'minutes', COALESCE((SELECT jsonb_agg(m) FROM minutes m), '[]'::jsonb)
      ) AS data
    `;
    return result.data;
  }, 5_000);
}
