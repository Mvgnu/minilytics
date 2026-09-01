import { createHash, timingSafeEqual } from "node:crypto";
import postgres from "postgres";

type ClientPayload = {
  eventType?: unknown;
  sessionId?: unknown;
  visitorId?: unknown;
  path?: unknown;
  title?: unknown;
  occurredAt?: unknown;
  attribution?: {
    landingPath?: unknown;
    landingReferrer?: unknown;
    utmSource?: unknown;
    utmMedium?: unknown;
    utmCampaign?: unknown;
  };
  targetUrl?: unknown;
  targetLabel?: unknown;
  properties?: unknown;
};

let client: ReturnType<typeof postgres> | undefined;

function db() {
  if (client) return client;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  client = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return client;
}

function text(value: unknown, max = 2048) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function optionalText(value: unknown, max = 2048) {
  const result = text(value, max);
  return result || null;
}

function validEventName(value: unknown) {
  const event = text(value, 64);
  return /^[a-z0-9_.:-]{1,64}$/i.test(event) ? event : "";
}

function safeProperties(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const json = JSON.stringify(value);
  return Buffer.byteLength(json) <= 4096 ? value : {};
}

function classifySource(input: {
  referrer: string;
  utmSource: string;
  utmMedium: string;
  siteDomain: string;
}) {
  const { referrer, utmSource, utmMedium, siteDomain } = input;

  if (utmSource || utmMedium) {
    return {
      source: "campaign",
      medium: utmMedium || "campaign",
      detail: utmSource || null,
    };
  }

  if (!referrer) {
    return { source: "direct", medium: "direct", detail: null };
  }

  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();

    const ownHost = siteDomain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
    if (host === ownHost || host.endsWith(`.${ownHost}`)) {
      return { source: "internal", medium: "internal", detail: host };
    }

    const searchEngines: Array<[RegExp, string]> = [
      [/(^|\.)google\./, "google"],
      [/(^|\.)bing\.com$/, "bing"],
      [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
      [/(^|\.)ecosia\.org$/, "ecosia"],
      [/(^|\.)yahoo\./, "yahoo"],
      [/(^|\.)yandex\./, "yandex"],
    ];

    for (const [pattern, name] of searchEngines) {
      if (pattern.test(host)) {
        return { source: "organic", medium: "search", detail: name };
      }
    }

    const social: Array<[RegExp, string]> = [
      [/(^|\.)instagram\.com$/, "instagram"],
      [/(^|\.)tiktok\.com$/, "tiktok"],
      [/(^|\.)facebook\.com$/, "facebook"],
      [/(^|\.)reddit\.com$/, "reddit"],
      [/(^|\.)x\.com$/, "x"],
      [/(^|\.)twitter\.com$/, "x"],
      [/(^|\.)linkedin\.com$/, "linkedin"],
      [/(^|\.)youtube\.com$/, "youtube"],
    ];

    for (const [pattern, name] of social) {
      if (pattern.test(host)) {
        return { source: "social", medium: "social", detail: name };
      }
    }

    return { source: "referral", medium: "referral", detail: host };
  } catch {
    return { source: "direct", medium: "direct", detail: null };
  }
}

function deviceType(userAgent: string) {
  if (/ipad|tablet/i.test(userAgent)) return "tablet";
  if (/mobile|iphone|android/i.test(userAgent)) return "mobile";
  return "desktop";
}

function secretsMatch(provided: string, storedHash: string) {
  const providedHash = createHash("sha256").update(provided).digest();
  const stored = Buffer.from(storedHash, "hex");
  return stored.length === providedHash.length && timingSafeEqual(providedHash, stored);
}

export async function ingestEvent(request: Request) {
  const siteId = text(request.headers.get("x-minilytics-site"), 128);
  const secret = text(request.headers.get("x-minilytics-secret"), 256);

  if (!siteId || !secret) {
    return { status: 401, error: "Missing site credentials." };
  }

  const sql = db();
  const [site] = await sql<{ secret_hash: string; domain: string }[]>`
    SELECT secret_hash, domain FROM sites WHERE id = ${siteId} LIMIT 1
  `;

  if (!site || !secretsMatch(secret, site.secret_hash)) {
    return { status: 401, error: "Invalid site credentials." };
  }

  let payload: ClientPayload;
  try {
    payload = (await request.json()) as ClientPayload;
  } catch {
    return { status: 400, error: "Invalid JSON." };
  }

  const eventType = validEventName(payload.eventType);
  const sessionId = text(payload.sessionId, 128);
  const path = text(payload.path, 2048);
  const occurredAt = new Date(text(payload.occurredAt, 64));

  if (!eventType || !sessionId || !path || Number.isNaN(occurredAt.getTime())) {
    return { status: 400, error: "Invalid event." };
  }

  const attribution = payload.attribution ?? {};
  const landingReferrer = text(attribution.landingReferrer, 2048);
  const source = classifySource({
    referrer: landingReferrer,
    utmSource: text(attribution.utmSource, 256),
    utmMedium: text(attribution.utmMedium, 256),
    siteDomain: site.domain,
  });

  const userAgent = text(request.headers.get("x-minilytics-user-agent"), 1024);
  const country = optionalText(request.headers.get("x-minilytics-country"), 8);

  await sql`
    INSERT INTO events (
      site_id,
      session_id,
      visitor_id,
      event_type,
      path,
      title,
      landing_path,
      landing_referrer,
      source,
      medium,
      source_detail,
      campaign,
      target_url,
      target_label,
      device_type,
      country,
      properties,
      occurred_at
    ) VALUES (
      ${siteId},
      ${sessionId},
      ${optionalText(payload.visitorId, 128)},
      ${eventType},
      ${path},
      ${optionalText(payload.title, 512)},
      ${optionalText(attribution.landingPath, 2048)},
      ${optionalText(landingReferrer, 2048)},
      ${source.source},
      ${source.medium},
      ${source.detail},
      ${optionalText(attribution.utmCampaign, 256)},
      ${optionalText(payload.targetUrl, 2048)},
      ${optionalText(payload.targetLabel, 256)},
      ${deviceType(userAgent)},
      ${country},
      ${sql.json(safeProperties(payload.properties))},
      ${occurredAt}
    )
  `;

  return { status: 204 };
}

export async function getSitesOverview(days = 30) {
  const sql = db();

  return sql<{
    id: string;
    name: string;
    domain: string;
    visitors: number;
    pageviews: number;
    events: number;
  }[]>`
    SELECT
      s.id,
      s.name,
      s.domain,
      COUNT(DISTINCT COALESCE(e.visitor_id, e.session_id))::int AS visitors,
      COUNT(*) FILTER (WHERE e.event_type = 'pageview')::int AS pageviews,
      COUNT(e.id)::int AS events
    FROM sites s
    LEFT JOIN events e
      ON e.site_id = s.id
      AND e.occurred_at >= now() - ${days} * interval '1 day'
    GROUP BY s.id, s.name, s.domain
    ORDER BY visitors DESC, s.name ASC
  `;
}

export async function getSiteDashboard(siteId: string, days = 30) {
  const sql = db();

  const [site] = await sql<{ id: string; name: string; domain: string }[]>`
    SELECT id, name, domain FROM sites WHERE id = ${siteId} LIMIT 1
  `;
  if (!site) return null;

  const [summary] = await sql<{
    visitors: number;
    sessions: number;
    pageviews: number;
    trackedEvents: number;
  }[]>`
    SELECT
      COUNT(DISTINCT COALESCE(visitor_id, session_id))::int AS visitors,
      COUNT(DISTINCT session_id)::int AS sessions,
      COUNT(*) FILTER (WHERE event_type = 'pageview')::int AS pageviews,
      COUNT(*) FILTER (WHERE event_type <> 'pageview')::int AS "trackedEvents"
    FROM events
    WHERE site_id = ${siteId}
      AND occurred_at >= now() - ${days} * interval '1 day'
  `;

  const traffic = await sql<{
    day: string;
    visitors: number;
    pageviews: number;
  }[]>`
    SELECT
      to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day,
      COUNT(DISTINCT COALESCE(visitor_id, session_id))::int AS visitors,
      COUNT(*) FILTER (WHERE event_type = 'pageview')::int AS pageviews
    FROM events
    WHERE site_id = ${siteId}
      AND occurred_at >= now() - ${days - 1} * interval '1 day'
    GROUP BY date_trunc('day', occurred_at)
    ORDER BY date_trunc('day', occurred_at)
  `;

  const pages = await sql<{
    path: string;
    views: number;
    visitors: number;
    clicks: number;
  }[]>`
    SELECT
      path,
      COUNT(*) FILTER (WHERE event_type = 'pageview')::int AS views,
      COUNT(DISTINCT COALESCE(visitor_id, session_id))
        FILTER (WHERE event_type = 'pageview')::int AS visitors,
      COUNT(*) FILTER (WHERE event_type IN ('click', 'outbound'))::int AS clicks
    FROM events
    WHERE site_id = ${siteId}
      AND occurred_at >= now() - ${days} * interval '1 day'
    GROUP BY path
    HAVING COUNT(*) FILTER (WHERE event_type = 'pageview') > 0
    ORDER BY views DESC
    LIMIT 12
  `;

  const sources = await sql<{
    source: string;
    detail: string | null;
    campaign: string | null;
    sessions: number;
  }[]>`
    SELECT
      source,
      source_detail AS detail,
      campaign,
      COUNT(DISTINCT session_id)::int AS sessions
    FROM events
    WHERE site_id = ${siteId}
      AND occurred_at >= now() - ${days} * interval '1 day'
    GROUP BY source, source_detail, campaign
    ORDER BY sessions DESC
    LIMIT 12
  `;

  const events = await sql<{
    eventType: string;
    count: number;
  }[]>`
    SELECT
      event_type AS "eventType",
      COUNT(*)::int AS count
    FROM events
    WHERE site_id = ${siteId}
      AND event_type <> 'pageview'
      AND occurred_at >= now() - ${days} * interval '1 day'
    GROUP BY event_type
    ORDER BY count DESC
    LIMIT 12
  `;

  const recentRows = await sql<{
    sessionId: string;
    eventType: string;
    path: string;
    source: string;
    detail: string | null;
    targetLabel: string | null;
    targetUrl: string | null;
    occurredAt: Date;
  }[]>`
    SELECT
      session_id AS "sessionId",
      event_type AS "eventType",
      path,
      source,
      source_detail AS detail,
      target_label AS "targetLabel",
      target_url AS "targetUrl",
      occurred_at AS "occurredAt"
    FROM events
    WHERE site_id = ${siteId}
      AND occurred_at >= now() - ${days} * interval '1 day'
    ORDER BY occurred_at DESC
    LIMIT 300
  `;

  const journeys = new Map<
    string,
    {
      sessionId: string;
      source: string;
      detail: string | null;
      events: typeof recentRows;
    }
  >();

  for (const row of recentRows) {
    let journey = journeys.get(row.sessionId);
    if (!journey) {
      if (journeys.size >= 8) continue;
      journey = {
        sessionId: row.sessionId,
        source: row.source,
        detail: row.detail,
        events: [],
      };
      journeys.set(row.sessionId, journey);
    }
    journey.events.push(row);
  }

  for (const journey of journeys.values()) {
    journey.events.sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );
  }

  return {
    site,
    summary: summary ?? { visitors: 0, sessions: 0, pageviews: 0, trackedEvents: 0 },
    traffic,
    pages,
    sources,
    events,
    journeys: [...journeys.values()],
  };
}
