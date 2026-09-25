import { createHmac, randomUUID } from "node:crypto";
import postgres from "postgres";
const WINDOW_MS = 30 * 60 * 1000;
let client: postgres.Sql | undefined;
function db() {
  return client ??= postgres(process.env.DATABASE_URL!, {max: 2, idle_timeout: 20,
    connection: {application_name: 'minilytics-session-matching', statement_timeout: 5000}});
}
export function networkKeys(secret: string, siteId: string, ip: string, userAgent: string, now: number) {
  const digest = (value: string) => createHmac('sha256', secret).update(value).digest('hex');
  const input = `${siteId}\0${ip}\0${userAgent}`;
  const bucket = Math.floor(now / WINDOW_MS);
  return {
    current: digest(`${bucket}\0${input}`),
    previous: digest(`${bucket - 1}\0${input}`),
    // Transaction-scoped lock only; this stable hash is never stored in a table.
    lock: BigInt.asIntN(64, BigInt(`0x${digest(`lock\0${input}`).slice(0,16)}`)).toString(),
  };
}
export async function networkSession(siteId: string, ip: string, userAgent: string) {
  const keys = networkKeys(process.env.MINILYTICS_EDGE_SECRET!, siteId, ip, userAgent, Date.now());
  return db().begin(async sql => {
    await sql`SELECT pg_advisory_xact_lock(${keys.lock}::bigint)`;
    const [existing] = await sql<{session_id: string}[]>`
      SELECT session_id FROM analytics_network_sessions
      WHERE site_id = ${siteId} AND match_key IN (${keys.current}, ${keys.previous})
        AND expires_at > now() ORDER BY expires_at DESC LIMIT 1
    `;
    const id = existing?.session_id ?? randomUUID();
    await sql`INSERT INTO analytics_network_sessions (site_id, match_key, session_id, expires_at)
      VALUES (${siteId}, ${keys.current}, ${id}, now() + interval '30 minutes')
      ON CONFLICT (site_id, match_key) DO UPDATE
        SET session_id = EXCLUDED.session_id, expires_at = EXCLUDED.expires_at`;
    await sql`DELETE FROM analytics_network_sessions WHERE site_id = ${siteId} AND match_key = ${keys.previous}`;
    return id;
  });
}
