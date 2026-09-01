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

type FunnelStep = { kind: "page" | "event" | "label"; value: string };
type FunnelDefinition = { id: string; name: string; steps: FunnelStep[] };
type FunnelEvent = {
  sessionId: string;
  eventType: string;
  path: string;
  targetLabel: string | null;
  occurredAt: Date;
};

let client: ReturnType<typeof postgres> | undefined;

function db() {
  if (client) return client;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
  client = postgres(databaseUrl, { max: 10, idle_timeout: 20, connect_timeout: 10 });
  return client;
}

function text(value: unknown, max = 2048) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function optionalText(value: unknown, max = 2048) {
  return text(value, max) || null;
}

function validEventName(value: unknown) {
  const event = text(value, 64);
  return /^[a-z0-9_.:-]{1,64}$/i.test(event) ? event : "";
}

function safeProperties(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Buffer.byteLength(JSON.stringify(value)) <= 4096 ? value : {};
}

function parseKeyEvents(value: unknown) {
  if (!Array.isArray(value)) return ["outbound"];
  return value
    .filter((item): item is string => typeof item === "string")
    .filter((item) => /^[a-z0-9_.:-]{1,64}$/i.test(item))
    .slice(0, 32);
}

function parseFunnels(value: unknown): FunnelDefinition[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const raw = item as Record<string, unknown>;
      const id = text(raw.id, 64);
      const name = text(raw.name, 128);
      if (!id || !name || !Array.isArray(raw.steps)) return null;
      const steps = raw.steps
        .map((step) => {
          if (!step || typeof step !== "object" || Array.isArray(step)) return null;
          const candidate = step as Record<string, unknown>;
          const kind = text(candidate.kind, 16);
          const value = text(candidate.value, 2048);
          if (!value || !["page", "event", "label"].includes(kind)) return null;
          return { kind: kind as FunnelStep["kind"], value };
        })
        .filter((step): step is FunnelStep => Boolean(step))
        .slice(0, 10);
      return steps.length >= 2 ? ({ id, name, steps } satisfies FunnelDefinition) : null;
    })
    .filter((item): item is FunnelDefinition => Boolean(item))
    .slice(0, 8);
}

function classifySource(input: {
  referrer: string;
  utmSource: string;
  utmMedium: string;
  siteDomain: string;
}) {
  const { referrer, utmSource, utmMedium, siteDomain } = input;
  if (utmSource || utmMedium) {
    return { source: "campaign", medium: utmMedium || "campaign", detail: utmSource || null };
  }
  if (!referrer) return { source: "direct", medium: "direct", detail: null };

  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
    const ownHost = siteDomain
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .toLowerCase();

    if (host === ownHost || host.endsWith(`.${ownHost}`)) {
      return { source: "internal", medium: "internal", detail: host };
    }

    const search: Array<[RegExp, string]> = [
      [/(^|\.)google\./, "google"],
      [/(^|\.)bing\.com$/, "bing"],
      [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
      [/(^|\.)ecosia\.org$/, "ecosia"],
      [/(^|\.)yahoo\./, "yahoo"],
      [/(^|\.)yandex\./, "yandex"],
    ];
    for (const [pattern, name] of search) {
      if (pattern.test(host)) return { source: "organic", medium: "search", detail: name };
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
      if (pattern.test(host)) return { source: "social", medium: "social", detail: name };
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

function matchesStep(step: FunnelStep, event: FunnelEvent) {
  if (step.kind === "event") return event.eventType === step.value;
  if (step.kind === "label") return event.targetLabel === step.value;
  if (event.eventType !== "pageview") return false;
  return step.value.endsWith("*")
    ? event.path.startsWith(step.value.slice(0, -1))
    : event.path === step.value;
}

function evaluateFunnels(definitions: FunnelDefinition[], rows: FunnelEvent[]) {
  const sessions = new Map<string, FunnelEvent[]>();
  for (const row of rows) {
    const events = sessions.get(row.sessionId);
    if (events) events.push(row);
    else sessions.set(row.sessionId, [row]);
  }

  return definitions.map((definition) => {
    const counts = definition.steps.map(() => 0);
    for (const events of sessions.values()) {
      let next = 0;
      for (const event of events) {
        const step = definition.steps[next];
        if (!step) break;
        if (!matchesStep(step, event)) continue;
        counts[next] += 1;
        next += 1;
      }
    }
    return {
      id: definition.id,
      name: definition.name,
      steps: definition.steps.map((step, index) => ({
        name: `${step.kind} · ${step.value}`,
        count: counts[index] ?? 0,
      })),
    };
  });
}

export async function ingestEvent(request: Request) {
  const siteId = text(request.headers.get("x-minilytics-site"), 128);
  const secret = text(request.headers.get("x-minilytics-secret"), 256);
  if (!siteId || !secret) return { status: 401, error: "Missing site credentials." };

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
      site_id, session_id, visitor_id, event_type, path, title,
      landing_path, landing_referrer, source, medium, source_detail, campaign,
      target_url, target_label, device_type, country, properties, occurred_at
    ) VALUES (
      ${siteId}, ${sessionId}, ${optionalText(payload.visitorId, 128)}, ${eventType},
      ${path}, ${optionalText(payload.title, 512)}, ${optionalText(attribution.landingPath, 2048)},
      ${optionalText(landingReferrer, 2048)}, ${source.source}, ${source.medium}, ${source.detail},
      ${optionalText(attribution.utmCampaign, 256)}, ${optionalText(payload.targetUrl, 2048)},
      ${optionalText(payload.targetLabel, 256)}, ${deviceType(userAgent)}, ${country},
      ${sql.json(safeProperties(payload.properties))}, ${occurredAt}
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
    SELECT s.id, s.name, s.domain,
      COUNT(DISTINCT COALESCE(e.visitor_id, e.session_id))::int AS visitors,
      COUNT(*) FILTER (WHERE e.event_type = 'pageview')::int AS pageviews,
      COUNT(e.id) FILTER (WHERE e.event_type NOT IN ('engagement', 'web_vital'))::int AS events
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
  const [siteRow] = await sql<{
    id: string;
    name: string;
    domain: string;
    keyEvents: unknown;
    funnels: unknown;
  }[]>`
    SELECT id, name, domain, key_events AS "keyEvents", funnels
    FROM sites WHERE id = ${siteId} LIMIT 1
  `;
  if (!siteRow) return null;

  const site = {
    id: siteRow.id,
    name: siteRow.name,
    domain: siteRow.domain,
    keyEvents: parseKeyEvents(siteRow.keyEvents),
  };
  const funnelDefinitions = parseFunnels(siteRow.funnels);

  const [summary] = await sql<{
    visitors: number;
    sessions: number;
    engagedSessions: number;
    engagementRate: number;
    bounceRate: number;
    pageviews: number;
    pagesPerSession: number;
    avgEngagementMs: number;
    keyEventCount: number;
    keyEventSessions: number;
    keyEventRate: number;
    trackedEvents: number;
  }[]>`
    WITH session_rollup AS (
      SELECT e.session_id,
        MIN(COALESCE(e.visitor_id, e.session_id)) AS visitor_key,
        COUNT(*) FILTER (WHERE e.event_type = 'pageview')::int AS pageviews,
        COALESCE(SUM(CASE
          WHEN e.event_type = 'engagement'
            AND COALESCE(e.properties->>'engagementMs', '') ~ '^[0-9]+(?:\\.[0-9]+)?$'
          THEN (e.properties->>'engagementMs')::double precision ELSE 0 END), 0)::double precision AS engagement_ms,
        COUNT(*) FILTER (WHERE s.key_events ? e.event_type)::int AS key_events,
        COUNT(*) FILTER (WHERE e.event_type NOT IN ('pageview', 'engagement', 'web_vital'))::int AS tracked_events
      FROM events e
      JOIN sites s ON s.id = e.site_id
      WHERE e.site_id = ${siteId}
        AND e.occurred_at >= now() - ${days} * interval '1 day'
      GROUP BY e.session_id
    )
    SELECT
      COUNT(DISTINCT visitor_key)::int AS visitors,
      COUNT(*)::int AS sessions,
      COUNT(*) FILTER (WHERE engagement_ms >= 10000 OR pageviews >= 2 OR key_events > 0)::int AS "engagedSessions",
      CASE WHEN COUNT(*) = 0 THEN 0 ELSE
        (100.0 * COUNT(*) FILTER (WHERE engagement_ms >= 10000 OR pageviews >= 2 OR key_events > 0) / COUNT(*))::double precision
      END AS "engagementRate",
      CASE WHEN COUNT(*) = 0 THEN 0 ELSE
        (100.0 - 100.0 * COUNT(*) FILTER (WHERE engagement_ms >= 10000 OR pageviews >= 2 OR key_events > 0) / COUNT(*))::double precision
      END AS "bounceRate",
      COALESCE(SUM(pageviews), 0)::int AS pageviews,
      CASE WHEN COUNT(*) = 0 THEN 0 ELSE SUM(pageviews)::double precision / COUNT(*) END AS "pagesPerSession",
      CASE WHEN COUNT(*) = 0 THEN 0 ELSE SUM(engagement_ms)::double precision / COUNT(*) END AS "avgEngagementMs",
      COALESCE(SUM(key_events), 0)::int AS "keyEventCount",
      COUNT(*) FILTER (WHERE key_events > 0)::int AS "keyEventSessions",
      CASE WHEN COUNT(*) = 0 THEN 0 ELSE
        (100.0 * COUNT(*) FILTER (WHERE key_events > 0) / COUNT(*))::double precision
      END AS "keyEventRate",
      COALESCE(SUM(tracked_events), 0)::int AS "trackedEvents"
    FROM session_rollup
  `;

  const traffic = await sql<{ day: string; visitors: number; pageviews: number }[]>`
    SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day,
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
    avgEngagementMs: number;
  }[]>`
    SELECT path,
      COUNT(*) FILTER (WHERE event_type = 'pageview')::int AS views,
      COUNT(DISTINCT COALESCE(visitor_id, session_id)) FILTER (WHERE event_type = 'pageview')::int AS visitors,
      COUNT(*) FILTER (WHERE event_type IN ('click', 'outbound', 'download'))::int AS clicks,
      CASE WHEN COUNT(*) FILTER (WHERE event_type = 'pageview') = 0 THEN 0 ELSE
        (COALESCE(SUM(CASE
          WHEN event_type = 'engagement'
            AND COALESCE(properties->>'engagementMs', '') ~ '^[0-9]+(?:\\.[0-9]+)?$'
          THEN (properties->>'engagementMs')::double precision ELSE 0 END), 0)
          / COUNT(*) FILTER (WHERE event_type = 'pageview'))::double precision
      END AS "avgEngagementMs"
    FROM events
    WHERE site_id = ${siteId}
      AND occurred_at >= now() - ${days} * interval '1 day'
    GROUP BY path
    HAVING COUNT(*) FILTER (WHERE event_type = 'pageview') > 0
    ORDER BY views DESC LIMIT 15
  `;

  const goals = await sql<{
    eventType: string;
    count: number;
    sessions: number;
    visitors: number;
  }[]>`
    SELECT e.event_type AS "eventType", COUNT(*)::int AS count,
      COUNT(DISTINCT e.session_id)::int AS sessions,
      COUNT(DISTINCT COALESCE(e.visitor_id, e.session_id))::int AS visitors
    FROM events e
    JOIN sites s ON s.id = e.site_id
    WHERE e.site_id = ${siteId}
      AND e.occurred_at >= now() - ${days} * interval '1 day'
      AND s.key_events ? e.event_type
    GROUP BY e.event_type
    ORDER BY count DESC
  `;

  const sessionAcquisition = await sql<{
    source: string;
    detail: string | null;
    campaign: string | null;
    sessions: number;
    engagedSessions: number;
    keyEventSessions: number;
  }[]>`
    WITH rollup AS (
      SELECT e.session_id,
        MIN(e.source) AS source,
        MIN(e.source_detail) AS detail,
        MIN(e.campaign) AS campaign,
        COUNT(*) FILTER (WHERE e.event_type = 'pageview')::int AS pageviews,
        COALESCE(SUM(CASE
          WHEN e.event_type = 'engagement'
            AND COALESCE(e.properties->>'engagementMs', '') ~ '^[0-9]+(?:\\.[0-9]+)?$'
          THEN (e.properties->>'engagementMs')::double precision ELSE 0 END), 0)::double precision AS engagement_ms,
        COUNT(*) FILTER (WHERE s.key_events ? e.event_type)::int AS key_events
      FROM events e
      JOIN sites s ON s.id = e.site_id
      WHERE e.site_id = ${siteId}
        AND e.occurred_at >= now() - ${days} * interval '1 day'
      GROUP BY e.session_id
    )
    SELECT source, detail, campaign, COUNT(*)::int AS sessions,
      COUNT(*) FILTER (WHERE engagement_ms >= 10000 OR pageviews >= 2 OR key_events > 0)::int AS "engagedSessions",
      COUNT(*) FILTER (WHERE key_events > 0)::int AS "keyEventSessions"
    FROM rollup
    GROUP BY source, detail, campaign
    ORDER BY sessions DESC LIMIT 15
  `;

  const userAcquisition = await sql<{
    source: string;
    detail: string | null;
    campaign: string | null;
    visitors: number;
  }[]>`
    WITH period_visitors AS (
      SELECT DISTINCT visitor_id
      FROM events
      WHERE site_id = ${siteId}
        AND visitor_id IS NOT NULL
        AND occurred_at >= now() - ${days} * interval '1 day'
    ), first_touch AS (
      SELECT DISTINCT ON (e.visitor_id)
        e.visitor_id, e.source, e.source_detail AS detail, e.campaign
      FROM events e
      JOIN period_visitors p ON p.visitor_id = e.visitor_id
      WHERE e.site_id = ${siteId}
      ORDER BY e.visitor_id, e.occurred_at ASC, e.id ASC
    )
    SELECT source, detail, campaign, COUNT(*)::int AS visitors
    FROM first_touch
    GROUP BY source, detail, campaign
    ORDER BY visitors DESC LIMIT 15
  `;

  const landingPages = await sql<{
    path: string;
    sessions: number;
    engagedSessions: number;
    keyEventSessions: number;
  }[]>`
    WITH rollup AS (
      SELECT e.session_id,
        COUNT(*) FILTER (WHERE e.event_type = 'pageview')::int AS pageviews,
        COALESCE(SUM(CASE
          WHEN e.event_type = 'engagement'
            AND COALESCE(e.properties->>'engagementMs', '') ~ '^[0-9]+(?:\\.[0-9]+)?$'
          THEN (e.properties->>'engagementMs')::double precision ELSE 0 END), 0)::double precision AS engagement_ms,
        COUNT(*) FILTER (WHERE s.key_events ? e.event_type)::int AS key_events
      FROM events e
      JOIN sites s ON s.id = e.site_id
      WHERE e.site_id = ${siteId}
        AND e.occurred_at >= now() - ${days} * interval '1 day'
      GROUP BY e.session_id
    ), landing AS (
      SELECT DISTINCT ON (session_id) session_id, path
      FROM events
      WHERE site_id = ${siteId}
        AND event_type = 'pageview'
        AND occurred_at >= now() - ${days} * interval '1 day'
      ORDER BY session_id, occurred_at ASC, id ASC
    )
    SELECT landing.path, COUNT(*)::int AS sessions,
      COUNT(*) FILTER (WHERE rollup.engagement_ms >= 10000 OR rollup.pageviews >= 2 OR rollup.key_events > 0)::int AS "engagedSessions",
      COUNT(*) FILTER (WHERE rollup.key_events > 0)::int AS "keyEventSessions"
    FROM landing JOIN rollup USING (session_id)
    GROUP BY landing.path
    ORDER BY sessions DESC LIMIT 15
  `;

  const exitPages = await sql<{ path: string; exits: number }[]>`
    WITH exits AS (
      SELECT DISTINCT ON (session_id) session_id, path
      FROM events
      WHERE site_id = ${siteId}
        AND event_type = 'pageview'
        AND occurred_at >= now() - ${days} * interval '1 day'
      ORDER BY session_id, occurred_at DESC, id DESC
    )
    SELECT path, COUNT(*)::int AS exits
    FROM exits GROUP BY path ORDER BY exits DESC LIMIT 15
  `;

  const webVitals = await sql<{
    metric: string;
    p75: number;
    samples: number;
    goodPercent: number;
  }[]>`
    SELECT properties->>'metric' AS metric,
      percentile_cont(0.75) WITHIN GROUP (
        ORDER BY (properties->>'value')::double precision
      )::double precision AS p75,
      COUNT(*)::int AS samples,
      (100.0 * COUNT(*) FILTER (WHERE properties->>'rating' = 'good') / COUNT(*))::double precision AS "goodPercent"
    FROM events
    WHERE site_id = ${siteId}
      AND event_type = 'web_vital'
      AND occurred_at >= now() - ${days} * interval '1 day'
      AND properties->>'metric' IN ('LCP', 'INP', 'CLS', 'FCP', 'TTFB')
      AND COALESCE(properties->>'value', '') ~ '^[0-9]+(?:\\.[0-9]+)?$'
    GROUP BY properties->>'metric'
    ORDER BY CASE properties->>'metric'
      WHEN 'LCP' THEN 1 WHEN 'INP' THEN 2 WHEN 'CLS' THEN 3
      WHEN 'FCP' THEN 4 WHEN 'TTFB' THEN 5 ELSE 6 END
  `;

  const events = await sql<{ eventType: string; count: number }[]>`
    SELECT event_type AS "eventType", COUNT(*)::int AS count
    FROM events
    WHERE site_id = ${siteId}
      AND event_type NOT IN ('pageview', 'engagement', 'web_vital')
      AND occurred_at >= now() - ${days} * interval '1 day'
    GROUP BY event_type ORDER BY count DESC LIMIT 15
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
    SELECT session_id AS "sessionId", event_type AS "eventType", path, source,
      source_detail AS detail, target_label AS "targetLabel", target_url AS "targetUrl",
      occurred_at AS "occurredAt"
    FROM events
    WHERE site_id = ${siteId}
      AND event_type NOT IN ('engagement', 'web_vital')
      AND occurred_at >= now() - ${days} * interval '1 day'
    ORDER BY occurred_at DESC LIMIT 300
  `;

  const journeys = new Map<string, {
    sessionId: string;
    source: string;
    detail: string | null;
    events: typeof recentRows;
  }>();
  for (const row of recentRows) {
    let journey = journeys.get(row.sessionId);
    if (!journey) {
      if (journeys.size >= 8) continue;
      journey = { sessionId: row.sessionId, source: row.source, detail: row.detail, events: [] };
      journeys.set(row.sessionId, journey);
    }
    journey.events.push(row);
  }
  for (const journey of journeys.values()) {
    journey.events.sort((a, b) =>
      new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );
  }

  let configuredFunnels: ReturnType<typeof evaluateFunnels> = [];
  if (funnelDefinitions.length) {
    const funnelRows = await sql<FunnelEvent[]>`
      SELECT session_id AS "sessionId", event_type AS "eventType", path,
        target_label AS "targetLabel", occurred_at AS "occurredAt"
      FROM events
      WHERE site_id = ${siteId}
        AND event_type NOT IN ('engagement', 'web_vital')
        AND occurred_at >= now() - ${days} * interval '1 day'
      ORDER BY session_id ASC, occurred_at ASC, id ASC
    `;
    configuredFunnels = evaluateFunnels(funnelDefinitions, funnelRows);
  }

  const safeSummary = summary ?? {
    visitors: 0,
    sessions: 0,
    engagedSessions: 0,
    engagementRate: 0,
    bounceRate: 0,
    pageviews: 0,
    pagesPerSession: 0,
    avgEngagementMs: 0,
    keyEventCount: 0,
    keyEventSessions: 0,
    keyEventRate: 0,
    trackedEvents: 0,
  };

  const sessionFunnel = {
    id: "session-quality",
    name: "Session funnel",
    steps: [
      { name: "Sessions", count: safeSummary.sessions },
      { name: "Engaged", count: safeSummary.engagedSessions },
      { name: "Key event", count: safeSummary.keyEventSessions },
    ],
  };

  return {
    site,
    summary: safeSummary,
    traffic,
    pages,
    goals,
    sessionAcquisition,
    userAcquisition,
    landingPages,
    exitPages,
    webVitals,
    events,
    journeys: [...journeys.values()],
    funnels: [sessionFunnel, ...configuredFunnels],
  };
}
