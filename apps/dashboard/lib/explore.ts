import postgres from "postgres";

type SearchValue = string | string[] | undefined;
export type ExploreSearchParams = Record<string, SearchValue>;
export type FunnelStep = { kind: "page" | "event" | "label"; value: string };
type FunnelDefinition = { id: string; name: string; steps: FunnelStep[] };
type FunnelEvent = {
  sessionId: string;
  eventType: string;
  path: string;
  targetLabel: string | null;
  occurredAt: Date;
};
type SessionDimension = {
  sessionId: string;
  visitorKey: string;
  source: string;
  medium: string;
  detail: string | null;
  campaign: string | null;
  landingPath: string | null;
  exitPath: string | null;
  pageviews: number;
  engagementMs: number;
  keyEventCount: number;
  keyEvents: string[];
  trackedEvents: number;
  firstAt: Date;
  lastAt: Date;
};
type JourneyEvent = {
  sessionId: string;
  eventType: string;
  path: string;
  source: string;
  medium: string;
  detail: string | null;
  targetLabel: string | null;
  targetUrl: string | null;
  occurredAt: Date;
};
type SiteRow = {
  id: string;
  name: string;
  domain: string;
  keyEvents: unknown;
  funnels: unknown;
};
type Sql = ReturnType<typeof postgres>;
type ResolvedQuery = ReturnType<typeof resolveExploreQuery>;
type ExploreFilters = ResolvedQuery["filters"];

let exploreClient: Sql | undefined;

function db() {
  if (exploreClient) return exploreClient;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
  exploreClient = postgres(databaseUrl, { max: 10, idle_timeout: 20, connect_timeout: 10 });
  return exploreClient;
}

function one(value: SearchValue) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function safeText(value: string, max = 2048) {
  return value.trim().slice(0, max);
}

function parseKeyEvents(value: unknown) {
  if (!Array.isArray(value)) return ["outbound"];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^[a-z0-9_.:-]{1,64}$/.test(item))
    .slice(0, 32);
}

function parseFunnels(value: unknown): FunnelDefinition[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const raw = item as Record<string, unknown>;
      const id = typeof raw.id === "string" ? raw.id.slice(0, 64) : "";
      const name = typeof raw.name === "string" ? raw.name.slice(0, 128) : "";
      if (!id || !name || !Array.isArray(raw.steps)) return null;
      const steps = raw.steps
        .map((step) => {
          if (!step || typeof step !== "object" || Array.isArray(step)) return null;
          const candidate = step as Record<string, unknown>;
          const kind = typeof candidate.kind === "string" ? candidate.kind.toLowerCase() : "";
          const rawValue = typeof candidate.value === "string" ? candidate.value.slice(0, 2048) : "";
          const stepValue = kind === "event" ? rawValue.toLowerCase() : rawValue;
          if (!stepValue || !["page", "event", "label"].includes(kind)) return null;
          return { kind: kind as FunnelStep["kind"], value: stepValue };
        })
        .filter((step): step is FunnelStep => Boolean(step))
        .slice(0, 10);
      return steps.length >= 2 ? ({ id, name, steps } satisfies FunnelDefinition) : null;
    })
    .filter((item): item is FunnelDefinition => Boolean(item))
    .slice(0, 8);
}

function startUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDateInput(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatRangeLabel(from: Date, toExclusive: Date, preset: string) {
  if (preset === "today") return "Today";
  if (preset === "7d") return "Last 7 days";
  if (preset === "30d") return "Last 30 days";
  const last = new Date(toExclusive.getTime() - 1);
  const fmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${fmt.format(from)} – ${fmt.format(last)}`;
}

export function resolveExploreQuery(params: ExploreSearchParams) {
  const now = new Date();
  const today = startUtcDay(now);
  const rawPreset = one(params.range);
  const preset = ["today", "7d", "30d", "custom"].includes(rawPreset) ? rawPreset : "30d";

  let from = addUtcDays(today, -29);
  let to = addUtcDays(today, 1);
  if (preset === "today") {
    from = today;
  } else if (preset === "7d") {
    from = addUtcDays(today, -6);
  } else if (preset === "custom") {
    const customFrom = parseDateInput(one(params.from));
    const customTo = parseDateInput(one(params.to));
    if (customFrom && customTo && customFrom <= customTo) {
      from = customFrom;
      to = addUtcDays(customTo, 1);
    }
  }

  const maxFrom = addUtcDays(to, -366);
  if (from < maxFrom) from = maxFrom;

  const filters = {
    source: safeText(one(params.source), 512),
    landing: safeText(one(params.landing), 2048),
    exit: safeText(one(params.exit), 2048),
    keyEvent: safeText(one(params.keyEvent), 80).toLowerCase(),
  };

  const rawPage = Number(one(params.page));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  return {
    range: {
      preset,
      from,
      to,
      fromInput: dateInput(from),
      toInput: dateInput(new Date(to.getTime() - 1)),
      label: formatRangeLabel(from, to, preset),
      bucket: preset === "today" ? ("hour" as const) : ("day" as const),
    },
    filters,
    page,
  };
}

function sourceToken(source: string, detail: string | null) {
  return `${source}|${detail ?? ""}`;
}

function parseSourceToken(token: string) {
  if (!token) return null;
  const separator = token.indexOf("|");
  if (separator === -1) return { source: token.slice(0, 64), detail: "" };
  return {
    source: token.slice(0, separator).slice(0, 64),
    detail: token.slice(separator + 1).slice(0, 256),
  };
}

async function loadSite(siteId: string) {
  const sql = db();
  const [siteRow] = await sql<SiteRow[]>`
    SELECT id, name, domain, key_events AS "keyEvents", funnels
    FROM sites
    WHERE id = ${siteId}
    LIMIT 1
  `;
  if (!siteRow) return null;
  return {
    site: {
      id: siteRow.id,
      name: siteRow.name,
      domain: siteRow.domain,
      keyEvents: parseKeyEvents(siteRow.keyEvents),
    },
    funnels: parseFunnels(siteRow.funnels),
  };
}

function sessionRollupCte(sql: Sql, siteId: string, from: Date, to: Date) {
  return sql`
    session_rollup AS (
      SELECT
        e.session_id AS session_id,
        (array_agg(COALESCE(e.visitor_id, e.session_id) ORDER BY e.occurred_at ASC, e.id ASC))[1] AS visitor_key,
        (array_agg(e.source ORDER BY e.occurred_at ASC, e.id ASC))[1] AS source,
        (array_agg(e.medium ORDER BY e.occurred_at ASC, e.id ASC))[1] AS medium,
        (array_agg(e.source_detail ORDER BY e.occurred_at ASC, e.id ASC))[1] AS detail,
        (array_agg(e.campaign ORDER BY e.occurred_at ASC, e.id ASC))[1] AS campaign,
        (array_agg(e.path ORDER BY e.occurred_at ASC, e.id ASC) FILTER (WHERE e.event_type = 'pageview'))[1] AS landing_path,
        (array_agg(e.path ORDER BY e.occurred_at DESC, e.id DESC) FILTER (WHERE e.event_type = 'pageview'))[1] AS exit_path,
        COUNT(*) FILTER (WHERE e.event_type = 'pageview')::int AS pageviews,
        COALESCE(SUM(CASE
          WHEN e.event_type = 'engagement' AND COALESCE(e.properties->>'engagementMs', '') ~ '^[0-9]+(?:\\.[0-9]+)?$'
          THEN (e.properties->>'engagementMs')::double precision ELSE 0 END), 0)::double precision AS engagement_ms,
        COUNT(*) FILTER (WHERE s.key_events ? e.event_type)::int AS key_event_count,
        COALESCE(array_remove(array_agg(DISTINCT CASE WHEN s.key_events ? e.event_type THEN e.event_type END), NULL), ARRAY[]::text[]) AS key_events,
        COUNT(*) FILTER (WHERE e.event_type NOT IN ('pageview', 'engagement', 'web_vital'))::int AS tracked_events,
        MIN(e.occurred_at) AS first_at,
        MAX(e.occurred_at) AS last_at
      FROM events e
      JOIN sites s ON s.id = e.site_id
      WHERE e.site_id = ${siteId}
        AND e.occurred_at >= ${from}
        AND e.occurred_at < ${to}
      GROUP BY e.session_id
    )
  `;
}

function filteredSessionsCte(sql: Sql, siteId: string, from: Date, to: Date, filters: ExploreFilters) {
  const source = parseSourceToken(filters.source);
  const eventName = filters.keyEvent.startsWith("event:") ? filters.keyEvent.slice(6) : "";
  return sql`
    WITH ${sessionRollupCte(sql, siteId, from, to)},
    filtered_sessions AS (
      SELECT *
      FROM session_rollup
      WHERE TRUE
        ${source ? sql`AND source = ${source.source} AND COALESCE(detail, '') = ${source.detail}` : sql``}
        ${filters.landing ? sql`AND landing_path = ${filters.landing}` : sql``}
        ${filters.exit ? sql`AND exit_path = ${filters.exit}` : sql``}
        ${filters.keyEvent === "yes" ? sql`AND key_event_count > 0` : sql``}
        ${filters.keyEvent === "no" ? sql`AND key_event_count = 0` : sql``}
        ${eventName ? sql`AND ${eventName} = ANY(key_events)` : sql``}
    )
  `;
}

function sessionColumns(sql: Sql) {
  return sql`
    session_id AS "sessionId",
    visitor_key AS "visitorKey",
    source,
    medium,
    detail,
    campaign,
    landing_path AS "landingPath",
    exit_path AS "exitPath",
    pageviews,
    engagement_ms AS "engagementMs",
    key_event_count AS "keyEventCount",
    key_events AS "keyEvents",
    tracked_events AS "trackedEvents",
    first_at AS "firstAt",
    last_at AS "lastAt"
  `;
}

async function loadFilterOptions(siteId: string, from: Date, to: Date, keyEvents: string[]) {
  const sql = db();
  const base = sessionRollupCte(sql, siteId, from, to);
  const [sources, landings, exits] = await Promise.all([
    sql<{ source: string; medium: string; detail: string | null; count: number }[]>`
      WITH ${base}
      SELECT source, MIN(medium) AS medium, detail, COUNT(*)::int AS count
      FROM session_rollup
      GROUP BY source, detail
      ORDER BY count DESC, source ASC, detail ASC NULLS FIRST
      LIMIT 80
    `,
    sql<{ value: string; count: number }[]>`
      WITH ${sessionRollupCte(sql, siteId, from, to)}
      SELECT landing_path AS value, COUNT(*)::int AS count
      FROM session_rollup
      WHERE landing_path IS NOT NULL
      GROUP BY landing_path
      ORDER BY count DESC, landing_path ASC
      LIMIT 100
    `,
    sql<{ value: string; count: number }[]>`
      WITH ${sessionRollupCte(sql, siteId, from, to)}
      SELECT exit_path AS value, COUNT(*)::int AS count
      FROM session_rollup
      WHERE exit_path IS NOT NULL
      GROUP BY exit_path
      ORDER BY count DESC, exit_path ASC
      LIMIT 100
    `,
  ]);
  return {
    sources: sources.map((row) => ({ ...row, value: sourceToken(row.source, row.detail) })),
    landings,
    exits,
    keyEvents,
  };
}

async function loadSummary(siteId: string, from: Date, to: Date, filters: ExploreFilters) {
  const sql = db();
  const [row] = await sql<{
    visitors: number; sessions: number; engagedSessions: number; engagementRate: number; bounceRate: number;
    pageviews: number; pagesPerSession: number; avgEngagementMs: number; keyEventCount: number;
    keyEventSessions: number; keyEventRate: number; trackedEvents: number;
  }[]>`
    ${filteredSessionsCte(sql, siteId, from, to, filters)}
    SELECT
      COUNT(DISTINCT visitor_key)::int AS visitors,
      COUNT(*)::int AS sessions,
      COUNT(*) FILTER (WHERE engagement_ms >= 10000 OR pageviews >= 2 OR key_event_count > 0)::int AS "engagedSessions",
      CASE WHEN COUNT(*) = 0 THEN 0 ELSE (100.0 * COUNT(*) FILTER (WHERE engagement_ms >= 10000 OR pageviews >= 2 OR key_event_count > 0) / COUNT(*))::double precision END AS "engagementRate",
      CASE WHEN COUNT(*) = 0 THEN 0 ELSE (100.0 - 100.0 * COUNT(*) FILTER (WHERE engagement_ms >= 10000 OR pageviews >= 2 OR key_event_count > 0) / COUNT(*))::double precision END AS "bounceRate",
      COALESCE(SUM(pageviews), 0)::int AS pageviews,
      CASE WHEN COUNT(*) = 0 THEN 0 ELSE SUM(pageviews)::double precision / COUNT(*) END AS "pagesPerSession",
      CASE WHEN COUNT(*) = 0 THEN 0 ELSE SUM(engagement_ms)::double precision / COUNT(*) END AS "avgEngagementMs",
      COALESCE(SUM(key_event_count), 0)::int AS "keyEventCount",
      COUNT(*) FILTER (WHERE key_event_count > 0)::int AS "keyEventSessions",
      CASE WHEN COUNT(*) = 0 THEN 0 ELSE (100.0 * COUNT(*) FILTER (WHERE key_event_count > 0) / COUNT(*))::double precision END AS "keyEventRate",
      COALESCE(SUM(tracked_events), 0)::int AS "trackedEvents"
    FROM filtered_sessions
  `;
  return row ?? {
    visitors: 0, sessions: 0, engagedSessions: 0, engagementRate: 0, bounceRate: 0,
    pageviews: 0, pagesPerSession: 0, avgEngagementMs: 0, keyEventCount: 0,
    keyEventSessions: 0, keyEventRate: 0, trackedEvents: 0,
  };
}

async function loadTraffic(siteId: string, from: Date, to: Date, filters: ExploreFilters, bucket: "hour" | "day") {
  const sql = db();
  const cte = filteredSessionsCte(sql, siteId, from, to, filters);
  const rows = bucket === "hour"
    ? await sql<{ bucket: Date; visitors: number; sessions: number }[]>`
        ${cte}
        SELECT date_trunc('hour', e.occurred_at) AS bucket,
          COUNT(DISTINCT COALESCE(e.visitor_id, e.session_id))::int AS visitors,
          COUNT(DISTINCT e.session_id)::int AS sessions
        FROM events e
        JOIN filtered_sessions fs ON fs.session_id = e.session_id
        WHERE e.site_id = ${siteId} AND e.occurred_at >= ${from} AND e.occurred_at < ${to}
        GROUP BY date_trunc('hour', e.occurred_at)
        ORDER BY date_trunc('hour', e.occurred_at)
      `
    : await sql<{ bucket: Date; visitors: number; sessions: number }[]>`
        ${cte}
        SELECT date_trunc('day', e.occurred_at) AS bucket,
          COUNT(DISTINCT COALESCE(e.visitor_id, e.session_id))::int AS visitors,
          COUNT(DISTINCT e.session_id)::int AS sessions
        FROM events e
        JOIN filtered_sessions fs ON fs.session_id = e.session_id
        WHERE e.site_id = ${siteId} AND e.occurred_at >= ${from} AND e.occurred_at < ${to}
        GROUP BY date_trunc('day', e.occurred_at)
        ORDER BY date_trunc('day', e.occurred_at)
      `;
  const formatter = bucket === "hour"
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
    : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
  return rows.map((row) => ({ point: row.bucket.toISOString(), label: formatter.format(row.bucket), visitors: row.visitors, sessions: row.sessions }));
}

async function loadPages(siteId: string, from: Date, to: Date, filters: ExploreFilters) {
  const sql = db();
  return sql<{ path: string; views: number; visitors: number; clicks: number; avgEngagementMs: number }[]>`
    ${filteredSessionsCte(sql, siteId, from, to, filters)}
    SELECT e.path,
      COUNT(*) FILTER (WHERE e.event_type = 'pageview')::int AS views,
      COUNT(DISTINCT COALESCE(e.visitor_id, e.session_id)) FILTER (WHERE e.event_type = 'pageview')::int AS visitors,
      COUNT(*) FILTER (WHERE e.event_type IN ('click', 'outbound', 'download'))::int AS clicks,
      CASE WHEN COUNT(*) FILTER (WHERE e.event_type = 'pageview') = 0 THEN 0 ELSE
        (COALESCE(SUM(CASE WHEN e.event_type = 'engagement' AND COALESCE(e.properties->>'engagementMs', '') ~ '^[0-9]+(?:\\.[0-9]+)?$'
          THEN (e.properties->>'engagementMs')::double precision ELSE 0 END), 0) / COUNT(*) FILTER (WHERE e.event_type = 'pageview'))::double precision
      END AS "avgEngagementMs"
    FROM events e
    JOIN filtered_sessions fs ON fs.session_id = e.session_id
    WHERE e.site_id = ${siteId} AND e.occurred_at >= ${from} AND e.occurred_at < ${to}
    GROUP BY e.path
    HAVING COUNT(*) FILTER (WHERE e.event_type = 'pageview') > 0
    ORDER BY views DESC
    LIMIT 15
  `;
}

async function loadGoals(siteId: string, from: Date, to: Date, filters: ExploreFilters, keyEvents: string[]) {
  if (!keyEvents.length) return [];
  const sql = db();
  return sql<{ eventType: string; count: number; sessions: number; visitors: number }[]>`
    ${filteredSessionsCte(sql, siteId, from, to, filters)}
    SELECT e.event_type AS "eventType", COUNT(*)::int AS count,
      COUNT(DISTINCT e.session_id)::int AS sessions,
      COUNT(DISTINCT COALESCE(e.visitor_id, e.session_id))::int AS visitors
    FROM events e
    JOIN filtered_sessions fs ON fs.session_id = e.session_id
    WHERE e.site_id = ${siteId} AND e.occurred_at >= ${from} AND e.occurred_at < ${to}
      AND e.event_type = ANY(${sql.array(keyEvents)})
    GROUP BY e.event_type
    ORDER BY count DESC
  `;
}

async function loadSessionAcquisition(siteId: string, from: Date, to: Date, filters: ExploreFilters) {
  const sql = db();
  return sql<{
    source: string; medium: string; detail: string | null; campaign: string | null;
    sessions: number; engagedSessions: number; keyEventSessions: number;
  }[]>`
    ${filteredSessionsCte(sql, siteId, from, to, filters)}
    SELECT source, medium, detail, campaign, COUNT(*)::int AS sessions,
      COUNT(*) FILTER (WHERE engagement_ms >= 10000 OR pageviews >= 2 OR key_event_count > 0)::int AS "engagedSessions",
      COUNT(*) FILTER (WHERE key_event_count > 0)::int AS "keyEventSessions"
    FROM filtered_sessions
    GROUP BY source, medium, detail, campaign
    ORDER BY sessions DESC
    LIMIT 15
  `;
}

async function loadUserAcquisition(siteId: string, from: Date, to: Date, filters: ExploreFilters) {
  const sql = db();
  return sql<{ source: string; medium: string; detail: string | null; campaign: string | null; visitors: number }[]>`
    ${filteredSessionsCte(sql, siteId, from, to, filters)},
    visitor_keys AS (
      SELECT DISTINCT visitor_key FROM filtered_sessions
    ),
    first_touch AS (
      SELECT DISTINCT ON (COALESCE(e.visitor_id, e.session_id))
        COALESCE(e.visitor_id, e.session_id) AS visitor_key,
        e.source, e.medium, e.source_detail AS detail, e.campaign
      FROM events e
      JOIN visitor_keys v ON v.visitor_key = COALESCE(e.visitor_id, e.session_id)
      WHERE e.site_id = ${siteId}
      ORDER BY COALESCE(e.visitor_id, e.session_id), e.occurred_at ASC, e.id ASC
    )
    SELECT source, medium, detail, campaign, COUNT(*)::int AS visitors
    FROM first_touch
    GROUP BY source, medium, detail, campaign
    ORDER BY visitors DESC
    LIMIT 15
  `;
}

async function loadLandingPages(siteId: string, from: Date, to: Date, filters: ExploreFilters) {
  const sql = db();
  return sql<{ path: string; sessions: number; engagedSessions: number; keyEventSessions: number }[]>`
    ${filteredSessionsCte(sql, siteId, from, to, filters)}
    SELECT landing_path AS path, COUNT(*)::int AS sessions,
      COUNT(*) FILTER (WHERE engagement_ms >= 10000 OR pageviews >= 2 OR key_event_count > 0)::int AS "engagedSessions",
      COUNT(*) FILTER (WHERE key_event_count > 0)::int AS "keyEventSessions"
    FROM filtered_sessions
    WHERE landing_path IS NOT NULL
    GROUP BY landing_path
    ORDER BY sessions DESC
    LIMIT 15
  `;
}

async function loadExitPages(siteId: string, from: Date, to: Date, filters: ExploreFilters) {
  const sql = db();
  return sql<{ path: string; exits: number }[]>`
    ${filteredSessionsCte(sql, siteId, from, to, filters)}
    SELECT exit_path AS path, COUNT(*)::int AS exits
    FROM filtered_sessions
    WHERE exit_path IS NOT NULL
    GROUP BY exit_path
    ORDER BY exits DESC
    LIMIT 15
  `;
}

async function loadWebVitals(siteId: string, from: Date, to: Date, filters: ExploreFilters) {
  const sql = db();
  return sql<{ metric: string; p75: number; samples: number; goodPercent: number }[]>`
    ${filteredSessionsCte(sql, siteId, from, to, filters)}
    SELECT e.properties->>'metric' AS metric,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY (e.properties->>'value')::double precision)::double precision AS p75,
      COUNT(*)::int AS samples,
      (100.0 * COUNT(*) FILTER (WHERE e.properties->>'rating' = 'good') / COUNT(*))::double precision AS "goodPercent"
    FROM events e
    JOIN filtered_sessions fs ON fs.session_id = e.session_id
    WHERE e.site_id = ${siteId} AND e.occurred_at >= ${from} AND e.occurred_at < ${to}
      AND e.event_type = 'web_vital'
      AND e.properties->>'metric' IN ('LCP', 'INP', 'CLS', 'FCP', 'TTFB')
      AND COALESCE(e.properties->>'value', '') ~ '^[0-9]+(?:\\.[0-9]+)?$'
    GROUP BY e.properties->>'metric'
    ORDER BY CASE e.properties->>'metric' WHEN 'LCP' THEN 1 WHEN 'INP' THEN 2 WHEN 'CLS' THEN 3 WHEN 'FCP' THEN 4 WHEN 'TTFB' THEN 5 ELSE 6 END
  `;
}

async function loadEvents(siteId: string, from: Date, to: Date, filters: ExploreFilters) {
  const sql = db();
  return sql<{ eventType: string; count: number }[]>`
    ${filteredSessionsCte(sql, siteId, from, to, filters)}
    SELECT e.event_type AS "eventType", COUNT(*)::int AS count
    FROM events e
    JOIN filtered_sessions fs ON fs.session_id = e.session_id
    WHERE e.site_id = ${siteId} AND e.occurred_at >= ${from} AND e.occurred_at < ${to}
      AND e.event_type NOT IN ('pageview', 'engagement', 'web_vital')
    GROUP BY e.event_type
    ORDER BY count DESC
    LIMIT 15
  `;
}

async function loadFunnelRows(siteId: string, from: Date, to: Date, filters: ExploreFilters) {
  const sql = db();
  return sql<FunnelEvent[]>`
    ${filteredSessionsCte(sql, siteId, from, to, filters)}
    SELECT e.session_id AS "sessionId", e.event_type AS "eventType", e.path,
      e.target_label AS "targetLabel", e.occurred_at AS "occurredAt"
    FROM events e
    JOIN filtered_sessions fs ON fs.session_id = e.session_id
    WHERE e.site_id = ${siteId} AND e.occurred_at >= ${from} AND e.occurred_at < ${to}
      AND e.event_type NOT IN ('engagement', 'web_vital')
    ORDER BY e.session_id ASC, e.occurred_at ASC, e.id ASC
  `;
}

async function loadFilteredSessions(
  siteId: string,
  from: Date,
  to: Date,
  filters: ExploreFilters,
  limit: number,
  offset = 0,
) {
  const sql = db();
  return sql<SessionDimension[]>`
    ${filteredSessionsCte(sql, siteId, from, to, filters)}
    SELECT ${sessionColumns(sql)}
    FROM filtered_sessions
    ORDER BY last_at DESC, session_id DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

async function loadFilteredSessionCount(siteId: string, from: Date, to: Date, filters: ExploreFilters) {
  const sql = db();
  const [row] = await sql<{ count: number }[]>`
    ${filteredSessionsCte(sql, siteId, from, to, filters)}
    SELECT COUNT(*)::int AS count FROM filtered_sessions
  `;
  return row?.count ?? 0;
}

async function loadJourneyEvents(siteId: string, sessionIds: string[], from: Date, to: Date) {
  if (!sessionIds.length) return [];
  const sql = db();
  return sql<JourneyEvent[]>`
    SELECT session_id AS "sessionId", event_type AS "eventType", path, source, medium,
      source_detail AS detail, target_label AS "targetLabel", target_url AS "targetUrl", occurred_at AS "occurredAt"
    FROM events
    WHERE site_id = ${siteId}
      AND occurred_at >= ${from} AND occurred_at < ${to}
      AND session_id = ANY(${sql.array(sessionIds)})
      AND event_type NOT IN ('engagement', 'web_vital')
    ORDER BY session_id ASC, occurred_at ASC, id ASC
  `;
}

function matchesStep(step: FunnelStep, event: FunnelEvent) {
  if (step.kind === "event") return event.eventType === step.value;
  if (step.kind === "label") return event.targetLabel === step.value;
  if (event.eventType !== "pageview") return false;
  return step.value.endsWith("*") ? event.path.startsWith(step.value.slice(0, -1)) : event.path === step.value;
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
      steps: definition.steps.map((step, index) => ({ name: `${step.kind} · ${step.value}`, count: counts[index] ?? 0 })),
    };
  });
}

function buildJourneys(sessions: SessionDimension[], events: JourneyEvent[]) {
  const bySession = new Map<string, JourneyEvent[]>();
  for (const event of events) {
    const bucket = bySession.get(event.sessionId);
    if (bucket) bucket.push(event);
    else bySession.set(event.sessionId, [event]);
  }
  return sessions.map((session) => ({
    sessionId: session.sessionId,
    visitorKey: session.visitorKey,
    source: session.source,
    medium: session.medium,
    detail: session.detail,
    campaign: session.campaign,
    landingPath: session.landingPath,
    exitPath: session.exitPath,
    engagementMs: session.engagementMs,
    keyEvents: session.keyEvents,
    firstAt: session.firstAt,
    lastAt: session.lastAt,
    events: bySession.get(session.sessionId) ?? [],
  }));
}

export async function getExploreDashboard(siteId: string, params: ExploreSearchParams = {}) {
  const resolved = resolveExploreQuery(params);
  const loaded = await loadSite(siteId);
  if (!loaded) return null;
  const { site, funnels: definitions } = loaded;
  const { range, filters } = resolved;

  const [
    filterOptions,
    summary,
    traffic,
    pages,
    goals,
    sessionAcquisition,
    userAcquisition,
    landingPages,
    exitPages,
    webVitals,
    events,
    recentSessions,
  ] = await Promise.all([
    loadFilterOptions(siteId, range.from, range.to, site.keyEvents),
    loadSummary(siteId, range.from, range.to, filters),
    loadTraffic(siteId, range.from, range.to, filters, range.bucket),
    loadPages(siteId, range.from, range.to, filters),
    loadGoals(siteId, range.from, range.to, filters, site.keyEvents),
    loadSessionAcquisition(siteId, range.from, range.to, filters),
    loadUserAcquisition(siteId, range.from, range.to, filters),
    loadLandingPages(siteId, range.from, range.to, filters),
    loadExitPages(siteId, range.from, range.to, filters),
    loadWebVitals(siteId, range.from, range.to, filters),
    loadEvents(siteId, range.from, range.to, filters),
    loadFilteredSessions(siteId, range.from, range.to, filters, 6),
  ]);

  let configuredFunnels: ReturnType<typeof evaluateFunnels> = [];
  if (definitions.length && summary.sessions) {
    configuredFunnels = evaluateFunnels(definitions, await loadFunnelRows(siteId, range.from, range.to, filters));
  }

  const journeys = buildJourneys(
    recentSessions,
    await loadJourneyEvents(siteId, recentSessions.map((row) => row.sessionId), range.from, range.to),
  );

  const sessionFunnel = {
    id: "session-quality",
    name: "Session funnel",
    steps: [
      { name: "Sessions", count: summary.sessions },
      { name: "Engaged", count: summary.engagedSessions },
      { name: "Key event", count: summary.keyEventSessions },
    ],
  };

  return {
    site,
    range,
    filters,
    filterOptions,
    summary,
    traffic,
    pages,
    goals,
    sessionAcquisition,
    userAcquisition,
    landingPages,
    exitPages,
    webVitals,
    events,
    journeys,
    funnels: [sessionFunnel, ...configuredFunnels],
  };
}

export async function getJourneyExplorer(siteId: string, params: ExploreSearchParams = {}, pageSize = 50) {
  const resolved = resolveExploreQuery(params);
  const loaded = await loadSite(siteId);
  if (!loaded) return null;
  const { site } = loaded;
  const { range, filters } = resolved;

  const [filterOptions, totalSessions] = await Promise.all([
    loadFilterOptions(siteId, range.from, range.to, site.keyEvents),
    loadFilteredSessionCount(siteId, range.from, range.to, filters),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalSessions / pageSize));
  const page = Math.min(resolved.page, totalPages);
  const pageSessions = await loadFilteredSessions(
    siteId,
    range.from,
    range.to,
    filters,
    pageSize,
    (page - 1) * pageSize,
  );
  const journeyEvents = await loadJourneyEvents(siteId, pageSessions.map((row) => row.sessionId), range.from, range.to);

  return {
    site,
    range,
    filters,
    filterOptions,
    page,
    pageSize,
    totalPages,
    totalSessions,
    journeys: buildJourneys(pageSessions, journeyEvents),
  };
}
