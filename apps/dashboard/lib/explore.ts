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

let exploreClient: ReturnType<typeof postgres> | undefined;

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

function isEngaged(session: SessionDimension) {
  return session.engagementMs >= 10_000 || session.pageviews >= 2 || session.keyEventCount > 0;
}

function matchesFilters(session: SessionDimension, filters: ReturnType<typeof resolveExploreQuery>["filters"]) {
  const source = parseSourceToken(filters.source);
  if (source && (session.source !== source.source || (session.detail ?? "") !== source.detail)) return false;
  if (filters.landing && session.landingPath !== filters.landing) return false;
  if (filters.exit && session.exitPath !== filters.exit) return false;
  if (filters.keyEvent === "yes" && session.keyEventCount === 0) return false;
  if (filters.keyEvent === "no" && session.keyEventCount > 0) return false;
  if (filters.keyEvent.startsWith("event:")) {
    const eventName = filters.keyEvent.slice(6);
    if (!session.keyEvents.includes(eventName)) return false;
  }
  return true;
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
    row: siteRow,
    site: {
      id: siteRow.id,
      name: siteRow.name,
      domain: siteRow.domain,
      keyEvents: parseKeyEvents(siteRow.keyEvents),
    },
    funnels: parseFunnels(siteRow.funnels),
  };
}

async function loadSessionDimensions(siteId: string, from: Date, to: Date) {
  const sql = db();
  return sql<SessionDimension[]>`
    SELECT
      e.session_id AS "sessionId",
      (array_agg(COALESCE(e.visitor_id, e.session_id) ORDER BY e.occurred_at ASC, e.id ASC))[1] AS "visitorKey",
      (array_agg(e.source ORDER BY e.occurred_at ASC, e.id ASC))[1] AS source,
      (array_agg(e.medium ORDER BY e.occurred_at ASC, e.id ASC))[1] AS medium,
      (array_agg(e.source_detail ORDER BY e.occurred_at ASC, e.id ASC))[1] AS detail,
      (array_agg(e.campaign ORDER BY e.occurred_at ASC, e.id ASC))[1] AS campaign,
      (array_agg(e.path ORDER BY e.occurred_at ASC, e.id ASC) FILTER (WHERE e.event_type = 'pageview'))[1] AS "landingPath",
      (array_agg(e.path ORDER BY e.occurred_at DESC, e.id DESC) FILTER (WHERE e.event_type = 'pageview'))[1] AS "exitPath",
      COUNT(*) FILTER (WHERE e.event_type = 'pageview')::int AS pageviews,
      COALESCE(SUM(CASE
        WHEN e.event_type = 'engagement' AND COALESCE(e.properties->>'engagementMs', '') ~ '^[0-9]+(?:\\.[0-9]+)?$'
        THEN (e.properties->>'engagementMs')::double precision ELSE 0 END), 0)::double precision AS "engagementMs",
      COUNT(*) FILTER (WHERE s.key_events ? e.event_type)::int AS "keyEventCount",
      COALESCE(array_remove(array_agg(DISTINCT CASE WHEN s.key_events ? e.event_type THEN e.event_type END), NULL), ARRAY[]::text[]) AS "keyEvents",
      COUNT(*) FILTER (WHERE e.event_type NOT IN ('pageview', 'engagement', 'web_vital'))::int AS "trackedEvents",
      MIN(e.occurred_at) AS "firstAt",
      MAX(e.occurred_at) AS "lastAt"
    FROM events e
    JOIN sites s ON s.id = e.site_id
    WHERE e.site_id = ${siteId}
      AND e.occurred_at >= ${from}
      AND e.occurred_at < ${to}
    GROUP BY e.session_id
    ORDER BY MAX(e.occurred_at) DESC
  `;
}

function groupCount<T>(rows: T[], key: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return counts;
}

function makeFilterOptions(sessions: SessionDimension[], keyEvents: string[]) {
  const sourceCounts = groupCount(sessions, (row) => sourceToken(row.source, row.detail));
  const sourceMeta = new Map<string, { source: string; medium: string; detail: string | null }>();
  for (const row of sessions) sourceMeta.set(sourceToken(row.source, row.detail), { source: row.source, medium: row.medium, detail: row.detail });

  const landingCounts = groupCount(sessions.filter((row) => row.landingPath), (row) => row.landingPath || "");
  const exitCounts = groupCount(sessions.filter((row) => row.exitPath), (row) => row.exitPath || "");

  return {
    sources: [...sourceCounts.entries()]
      .map(([value, count]) => ({ value, count, ...sourceMeta.get(value)! }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, 80),
    landings: [...landingCounts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, 100),
    exits: [...exitCounts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, 100),
    keyEvents,
  };
}

function summaryFromSessions(sessions: SessionDimension[]) {
  const engagedSessions = sessions.filter(isEngaged).length;
  const keyEventSessions = sessions.filter((row) => row.keyEventCount > 0).length;
  const pageviews = sessions.reduce((sum, row) => sum + row.pageviews, 0);
  const engagementMs = sessions.reduce((sum, row) => sum + row.engagementMs, 0);
  const keyEventCount = sessions.reduce((sum, row) => sum + row.keyEventCount, 0);
  const trackedEvents = sessions.reduce((sum, row) => sum + row.trackedEvents, 0);
  const sessionCount = sessions.length;
  return {
    visitors: new Set(sessions.map((row) => row.visitorKey)).size,
    sessions: sessionCount,
    engagedSessions,
    engagementRate: sessionCount ? (100 * engagedSessions) / sessionCount : 0,
    bounceRate: sessionCount ? 100 - (100 * engagedSessions) / sessionCount : 0,
    pageviews,
    pagesPerSession: sessionCount ? pageviews / sessionCount : 0,
    avgEngagementMs: sessionCount ? engagementMs / sessionCount : 0,
    keyEventCount,
    keyEventSessions,
    keyEventRate: sessionCount ? (100 * keyEventSessions) / sessionCount : 0,
    trackedEvents,
  };
}

function groupSessionAcquisition(sessions: SessionDimension[]) {
  const groups = new Map<string, {
    source: string; medium: string; detail: string | null; campaign: string | null;
    sessions: number; engagedSessions: number; keyEventSessions: number;
  }>();
  for (const row of sessions) {
    const key = `${row.source}\0${row.medium}\0${row.detail ?? ""}\0${row.campaign ?? ""}`;
    const current = groups.get(key) ?? {
      source: row.source, medium: row.medium, detail: row.detail, campaign: row.campaign,
      sessions: 0, engagedSessions: 0, keyEventSessions: 0,
    };
    current.sessions += 1;
    if (isEngaged(row)) current.engagedSessions += 1;
    if (row.keyEventCount > 0) current.keyEventSessions += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 15);
}

function groupLandingPages(sessions: SessionDimension[]) {
  const groups = new Map<string, { path: string; sessions: number; engagedSessions: number; keyEventSessions: number }>();
  for (const row of sessions) {
    if (!row.landingPath) continue;
    const current = groups.get(row.landingPath) ?? { path: row.landingPath, sessions: 0, engagedSessions: 0, keyEventSessions: 0 };
    current.sessions += 1;
    if (isEngaged(row)) current.engagedSessions += 1;
    if (row.keyEventCount > 0) current.keyEventSessions += 1;
    groups.set(row.landingPath, current);
  }
  return [...groups.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 15);
}

function groupExitPages(sessions: SessionDimension[]) {
  const counts = groupCount(sessions.filter((row) => row.exitPath), (row) => row.exitPath || "");
  return [...counts.entries()].map(([path, exits]) => ({ path, exits })).sort((a, b) => b.exits - a.exits).slice(0, 15);
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

async function loadTraffic(siteId: string, sessionIds: string[], from: Date, to: Date, bucket: "hour" | "day") {
  if (!sessionIds.length) return [];
  const sql = db();
  const rows = bucket === "hour"
    ? await sql<{ bucket: Date; visitors: number; sessions: number }[]>`
        SELECT date_trunc('hour', occurred_at) AS bucket,
          COUNT(DISTINCT COALESCE(visitor_id, session_id))::int AS visitors,
          COUNT(DISTINCT session_id)::int AS sessions
        FROM events
        WHERE site_id = ${siteId}
          AND occurred_at >= ${from} AND occurred_at < ${to}
          AND session_id = ANY(${sql.array(sessionIds)})
        GROUP BY date_trunc('hour', occurred_at)
        ORDER BY date_trunc('hour', occurred_at)
      `
    : await sql<{ bucket: Date; visitors: number; sessions: number }[]>`
        SELECT date_trunc('day', occurred_at) AS bucket,
          COUNT(DISTINCT COALESCE(visitor_id, session_id))::int AS visitors,
          COUNT(DISTINCT session_id)::int AS sessions
        FROM events
        WHERE site_id = ${siteId}
          AND occurred_at >= ${from} AND occurred_at < ${to}
          AND session_id = ANY(${sql.array(sessionIds)})
        GROUP BY date_trunc('day', occurred_at)
        ORDER BY date_trunc('day', occurred_at)
      `;
  const formatter = bucket === "hour"
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
    : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
  return rows.map((row) => ({ point: row.bucket.toISOString(), label: formatter.format(row.bucket), visitors: row.visitors, sessions: row.sessions }));
}

async function loadPages(siteId: string, sessionIds: string[], from: Date, to: Date) {
  if (!sessionIds.length) return [];
  const sql = db();
  return sql<{ path: string; views: number; visitors: number; clicks: number; avgEngagementMs: number }[]>`
    SELECT path,
      COUNT(*) FILTER (WHERE event_type = 'pageview')::int AS views,
      COUNT(DISTINCT COALESCE(visitor_id, session_id)) FILTER (WHERE event_type = 'pageview')::int AS visitors,
      COUNT(*) FILTER (WHERE event_type IN ('click', 'outbound', 'download'))::int AS clicks,
      CASE WHEN COUNT(*) FILTER (WHERE event_type = 'pageview') = 0 THEN 0 ELSE
        (COALESCE(SUM(CASE WHEN event_type = 'engagement' AND COALESCE(properties->>'engagementMs', '') ~ '^[0-9]+(?:\\.[0-9]+)?$'
          THEN (properties->>'engagementMs')::double precision ELSE 0 END), 0) / COUNT(*) FILTER (WHERE event_type = 'pageview'))::double precision
      END AS "avgEngagementMs"
    FROM events
    WHERE site_id = ${siteId}
      AND occurred_at >= ${from} AND occurred_at < ${to}
      AND session_id = ANY(${sql.array(sessionIds)})
    GROUP BY path
    HAVING COUNT(*) FILTER (WHERE event_type = 'pageview') > 0
    ORDER BY views DESC
    LIMIT 15
  `;
}

async function loadGoals(siteId: string, sessionIds: string[], keyEvents: string[], from: Date, to: Date) {
  if (!sessionIds.length || !keyEvents.length) return [];
  const sql = db();
  return sql<{ eventType: string; count: number; sessions: number; visitors: number }[]>`
    SELECT event_type AS "eventType", COUNT(*)::int AS count,
      COUNT(DISTINCT session_id)::int AS sessions,
      COUNT(DISTINCT COALESCE(visitor_id, session_id))::int AS visitors
    FROM events
    WHERE site_id = ${siteId}
      AND occurred_at >= ${from} AND occurred_at < ${to}
      AND session_id = ANY(${sql.array(sessionIds)})
      AND event_type = ANY(${sql.array(keyEvents)})
    GROUP BY event_type
    ORDER BY count DESC
  `;
}

async function loadUserAcquisition(siteId: string, visitorKeys: string[]) {
  if (!visitorKeys.length) return [];
  const sql = db();
  const rows = await sql<{ visitorKey: string; source: string; medium: string; detail: string | null; campaign: string | null }[]>`
    SELECT DISTINCT ON (COALESCE(visitor_id, session_id))
      COALESCE(visitor_id, session_id) AS "visitorKey", source, medium, source_detail AS detail, campaign
    FROM events
    WHERE site_id = ${siteId}
      AND COALESCE(visitor_id, session_id) = ANY(${sql.array(visitorKeys)})
    ORDER BY COALESCE(visitor_id, session_id), occurred_at ASC, id ASC
  `;
  const groups = new Map<string, { source: string; medium: string; detail: string | null; campaign: string | null; visitors: number }>();
  for (const row of rows) {
    const key = `${row.source}\0${row.medium}\0${row.detail ?? ""}\0${row.campaign ?? ""}`;
    const current = groups.get(key) ?? { source: row.source, medium: row.medium, detail: row.detail, campaign: row.campaign, visitors: 0 };
    current.visitors += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.visitors - a.visitors).slice(0, 15);
}

async function loadWebVitals(siteId: string, sessionIds: string[], from: Date, to: Date) {
  if (!sessionIds.length) return [];
  const sql = db();
  return sql<{ metric: string; p75: number; samples: number; goodPercent: number }[]>`
    SELECT properties->>'metric' AS metric,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY (properties->>'value')::double precision)::double precision AS p75,
      COUNT(*)::int AS samples,
      (100.0 * COUNT(*) FILTER (WHERE properties->>'rating' = 'good') / COUNT(*))::double precision AS "goodPercent"
    FROM events
    WHERE site_id = ${siteId}
      AND occurred_at >= ${from} AND occurred_at < ${to}
      AND session_id = ANY(${sql.array(sessionIds)})
      AND event_type = 'web_vital'
      AND properties->>'metric' IN ('LCP', 'INP', 'CLS', 'FCP', 'TTFB')
      AND COALESCE(properties->>'value', '') ~ '^[0-9]+(?:\\.[0-9]+)?$'
    GROUP BY properties->>'metric'
    ORDER BY CASE properties->>'metric' WHEN 'LCP' THEN 1 WHEN 'INP' THEN 2 WHEN 'CLS' THEN 3 WHEN 'FCP' THEN 4 WHEN 'TTFB' THEN 5 ELSE 6 END
  `;
}

async function loadEvents(siteId: string, sessionIds: string[], from: Date, to: Date) {
  if (!sessionIds.length) return [];
  const sql = db();
  return sql<{ eventType: string; count: number }[]>`
    SELECT event_type AS "eventType", COUNT(*)::int AS count
    FROM events
    WHERE site_id = ${siteId}
      AND occurred_at >= ${from} AND occurred_at < ${to}
      AND session_id = ANY(${sql.array(sessionIds)})
      AND event_type NOT IN ('pageview', 'engagement', 'web_vital')
    GROUP BY event_type
    ORDER BY count DESC
    LIMIT 15
  `;
}

async function loadFunnelRows(siteId: string, sessionIds: string[], from: Date, to: Date) {
  if (!sessionIds.length) return [];
  const sql = db();
  return sql<FunnelEvent[]>`
    SELECT session_id AS "sessionId", event_type AS "eventType", path,
      target_label AS "targetLabel", occurred_at AS "occurredAt"
    FROM events
    WHERE site_id = ${siteId}
      AND occurred_at >= ${from} AND occurred_at < ${to}
      AND session_id = ANY(${sql.array(sessionIds)})
      AND event_type NOT IN ('engagement', 'web_vital')
    ORDER BY session_id ASC, occurred_at ASC, id ASC
  `;
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

async function loadContext(siteId: string, params: ExploreSearchParams) {
  const resolved = resolveExploreQuery(params);
  const loaded = await loadSite(siteId);
  if (!loaded) return null;
  const allSessions = await loadSessionDimensions(siteId, resolved.range.from, resolved.range.to);
  const filterOptions = makeFilterOptions(allSessions, loaded.site.keyEvents);
  const filteredSessions = allSessions.filter((session) => matchesFilters(session, resolved.filters));
  return { ...loaded, ...resolved, allSessions, filterOptions, filteredSessions };
}

export async function getExploreDashboard(siteId: string, params: ExploreSearchParams = {}) {
  const context = await loadContext(siteId, params);
  if (!context) return null;
  const { site, funnels: definitions, range, filters, filterOptions, filteredSessions } = context;
  const sessionIds = filteredSessions.map((row) => row.sessionId);
  const visitorKeys = Array.from(new Set<string>(filteredSessions.map((row) => row.visitorKey)));
  const summary = summaryFromSessions(filteredSessions);

  const [traffic, pages, goals, userAcquisition, webVitals, events] = await Promise.all([
    loadTraffic(siteId, sessionIds, range.from, range.to, range.bucket),
    loadPages(siteId, sessionIds, range.from, range.to),
    loadGoals(siteId, sessionIds, site.keyEvents, range.from, range.to),
    loadUserAcquisition(siteId, visitorKeys),
    loadWebVitals(siteId, sessionIds, range.from, range.to),
    loadEvents(siteId, sessionIds, range.from, range.to),
  ]);

  const sessionAcquisition = groupSessionAcquisition(filteredSessions);
  const landingPages = groupLandingPages(filteredSessions);
  const exitPages = groupExitPages(filteredSessions);

  let configuredFunnels: ReturnType<typeof evaluateFunnels> = [];
  if (definitions.length && sessionIds.length) {
    configuredFunnels = evaluateFunnels(definitions, await loadFunnelRows(siteId, sessionIds, range.from, range.to));
  }

  const recentSessions = [...filteredSessions].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime()).slice(0, 6);
  const journeys = buildJourneys(recentSessions, await loadJourneyEvents(siteId, recentSessions.map((row) => row.sessionId), range.from, range.to));

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
  const context = await loadContext(siteId, params);
  if (!context) return null;
  const { site, range, filters, filterOptions, filteredSessions } = context;
  const totalSessions = filteredSessions.length;
  const totalPages = Math.max(1, Math.ceil(totalSessions / pageSize));
  const page = Math.min(context.page, totalPages);
  const start = (page - 1) * pageSize;
  const pageSessions = [...filteredSessions]
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
    .slice(start, start + pageSize);
  const events = await loadJourneyEvents(siteId, pageSessions.map((row) => row.sessionId), range.from, range.to);
  return {
    site,
    range,
    filters,
    filterOptions,
    page,
    pageSize,
    totalPages,
    totalSessions,
    journeys: buildJourneys(pageSessions, events),
  };
}
