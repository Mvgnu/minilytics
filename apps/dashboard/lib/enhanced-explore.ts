import { cachedReport } from "./report-cache";
import { reportDb as db, type ReportSql as Sql } from "./report-db";
import { getExploreDashboard, getJourneyExplorer, sessionRollupCte, withSessionRollups } from "./explore";
import type { ExploreSearchParams } from "./explore";

export type { ExploreSearchParams } from "./explore";

type SearchValue = string | string[] | undefined;
type Filters = {
  source: string;
  landing: string;
  exit: string;
  keyEvent: string;
};

type Summary = {
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
};

type TrafficPoint = {
  point: string;
  label: string;
  visitors: number;
  sessions: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const PRESETS = new Set([
  "today",
  "yesterday",
  "7d",
  "30d",
  "mtd",
  "90d",
  "custom",
]);

function one(value: SearchValue) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function startUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function startUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function parseDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDateRange(from: Date, endDayExclusive: Date) {
  const formatter = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const last = new Date(endDayExclusive.getTime() - 1);
  if (dateInput(from) === dateInput(last)) return formatter.format(from);
  return `${formatter.format(from)} – ${formatter.format(last)}`;
}

export function resolveEnhancedRange(params: ExploreSearchParams = {}) {
  const now = new Date();
  const today = startUtcDay(now);
  const requested = one(params.range);
  const preset = PRESETS.has(requested) ? requested : "30d";

  let from = addUtcDays(today, -29);
  let endDayExclusive = addUtcDays(today, 1);
  let label = "Last 30 days";

  if (preset === "today") {
    from = today;
    label = "Today";
  } else if (preset === "yesterday") {
    from = addUtcDays(today, -1);
    endDayExclusive = today;
    label = "Yesterday";
  } else if (preset === "7d") {
    from = addUtcDays(today, -6);
    label = "Last 7 days";
  } else if (preset === "mtd") {
    from = startUtcMonth(today);
    label = "Month to date";
  } else if (preset === "90d") {
    from = addUtcDays(today, -89);
    label = "Last 90 days";
  } else if (preset === "custom") {
    const customFrom = parseDateInput(one(params.from));
    const customTo = parseDateInput(one(params.to));
    if (customFrom && customTo && customFrom <= customTo) {
      from = customFrom;
      endDayExclusive = addUtcDays(customTo, 1);
      label = formatDateRange(from, endDayExclusive);
    }
  }

  const maximumFrom = addUtcDays(endDayExclusive, -366);
  if (from < maximumFrom) from = maximumFrom;

  const selectedDays = Math.max(
    1,
    Math.round((endDayExclusive.getTime() - from.getTime()) / DAY_MS),
  );
  const includesToday = from <= today && endDayExclusive > today;
  const queryTo = includesToday && now < endDayExclusive ? now : endDayExclusive;
  const comparisonFrom = addUtcDays(from, -selectedDays);
  const comparisonTo = addUtcDays(queryTo, -selectedDays);
  const bucket = selectedDays === 1 ? ("hour" as const) : ("day" as const);

  return {
    preset,
    from,
    to: queryTo,
    endDayExclusive,
    fromInput: dateInput(from),
    toInput: dateInput(new Date(endDayExclusive.getTime() - 1)),
    label,
    bucket,
    selectedDays,
    comparisonFrom,
    comparisonTo,
    comparisonLabel: formatDateRange(comparisonFrom, from),
  };
}

function filtersFrom(params: ExploreSearchParams): Filters {
  return {
    source: one(params.source).trim().slice(0, 512),
    landing: one(params.landing).trim().slice(0, 2048),
    exit: one(params.exit).trim().slice(0, 2048),
    keyEvent: one(params.keyEvent).trim().toLowerCase().slice(0, 80),
  };
}

function baseParams(
  params: ExploreSearchParams,
  range: ReturnType<typeof resolveEnhancedRange>,
) {
  const result: ExploreSearchParams = {
    range: "custom",
    from: range.fromInput,
    to: range.toInput,
  };
  for (const key of ["source", "landing", "exit", "keyEvent", "page"] as const) {
    const value = one(params[key]);
    if (value) result[key] = value;
  }
  return result;
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

function filteredSessionsCte(
  sql: Sql,
  siteId: string,
  from: Date,
  to: Date,
  filters: Filters,
) {
  const source = parseSourceToken(filters.source);
  const eventName = filters.keyEvent.startsWith("event:")
    ? filters.keyEvent.slice(6)
    : "";

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

async function loadSummary(
  siteId: string,
  from: Date,
  to: Date,
  filters: Filters,
): Promise<Summary> {
  const sql = db();
  const [row] = await sql<Summary[]>`
    ${filteredSessionsCte(sql, siteId, from, to, filters)}
    SELECT
      COUNT(DISTINCT visitor_key)::int AS visitors,
      COUNT(*)::int AS sessions,
      COUNT(*) FILTER (
        WHERE engagement_ms >= 10000 OR pageviews >= 2 OR key_event_count > 0
      )::int AS "engagedSessions",
      CASE WHEN COUNT(*) = 0 THEN 0 ELSE (
        100.0 * COUNT(*) FILTER (
          WHERE engagement_ms >= 10000 OR pageviews >= 2 OR key_event_count > 0
        ) / COUNT(*)
      )::double precision END AS "engagementRate",
      CASE WHEN COUNT(*) = 0 THEN 0 ELSE (
        100.0 - 100.0 * COUNT(*) FILTER (
          WHERE engagement_ms >= 10000 OR pageviews >= 2 OR key_event_count > 0
        ) / COUNT(*)
      )::double precision END AS "bounceRate",
      COALESCE(SUM(pageviews), 0)::int AS pageviews,
      CASE WHEN COUNT(*) = 0 THEN 0 ELSE
        SUM(pageviews)::double precision / COUNT(*)
      END AS "pagesPerSession",
      CASE WHEN COUNT(*) = 0 THEN 0 ELSE
        SUM(engagement_ms)::double precision / COUNT(*)
      END AS "avgEngagementMs",
      COALESCE(SUM(key_event_count), 0)::int AS "keyEventCount",
      COUNT(*) FILTER (WHERE key_event_count > 0)::int AS "keyEventSessions",
      CASE WHEN COUNT(*) = 0 THEN 0 ELSE (
        100.0 * COUNT(*) FILTER (WHERE key_event_count > 0) / COUNT(*)
      )::double precision END AS "keyEventRate",
      COALESCE(SUM(tracked_events), 0)::int AS "trackedEvents"
    FROM filtered_sessions
  `;

  return row ?? {
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
}

async function loadTrafficRows(
  siteId: string,
  from: Date,
  to: Date,
  filters: Filters,
  bucket: "hour" | "day",
) {
  const sql = db();
  const filtered = Boolean(filters.source || filters.landing || filters.exit || filters.keyEvent);
  if (bucket === "hour") {
    return sql<{ bucket: Date; visitors: number; sessions: number }[]>`
      ${filtered ? filteredSessionsCte(sql, siteId, from, to, filters) : sql``}
      SELECT
        date_trunc('hour', e.occurred_at) AS bucket,
        COUNT(DISTINCT COALESCE(e.visitor_id, e.session_id))::int AS visitors,
        COUNT(DISTINCT e.session_id)::int AS sessions
      FROM events e
      ${filtered ? sql`JOIN filtered_sessions fs ON fs.session_id = e.session_id` : sql``}
      WHERE e.site_id = ${siteId}
        AND e.occurred_at >= ${from}
        AND e.occurred_at < ${to}
      GROUP BY date_trunc('hour', e.occurred_at)
      ORDER BY date_trunc('hour', e.occurred_at)
    `;
  }

  return sql<{ bucket: Date; visitors: number; sessions: number }[]>`
    ${filtered ? filteredSessionsCte(sql, siteId, from, to, filters) : sql``}
    SELECT
      date_trunc('day', e.occurred_at) AS bucket,
      COUNT(DISTINCT COALESCE(e.visitor_id, e.session_id))::int AS visitors,
      COUNT(DISTINCT e.session_id)::int AS sessions
    FROM events e
    ${filtered ? sql`JOIN filtered_sessions fs ON fs.session_id = e.session_id` : sql``}
    WHERE e.site_id = ${siteId}
      AND e.occurred_at >= ${from}
      AND e.occurred_at < ${to}
    GROUP BY date_trunc('day', e.occurred_at)
    ORDER BY date_trunc('day', e.occurred_at)
  `;
}

function completeTrafficSeries(
  rows: Array<{ bucket: Date; visitors: number; sessions: number }>,
  from: Date,
  to: Date,
  bucket: "hour" | "day",
  selectedDays: number,
): TrafficPoint[] {
  const step = bucket === "hour" ? HOUR_MS : DAY_MS;
  const count =
    bucket === "hour"
      ? Math.max(
          1,
          Math.min(24, Math.ceil((to.getTime() - from.getTime()) / HOUR_MS)),
        )
      : selectedDays;
  const rowMap = new Map(
    rows.map((row) => [new Date(row.bucket).toISOString(), row]),
  );
  const formatter =
    bucket === "hour"
      ? new Intl.DateTimeFormat("en", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
          timeZone: "UTC",
        })
      : new Intl.DateTimeFormat("en", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(from.getTime() + index * step);
    const key = date.toISOString();
    const row = rowMap.get(key);
    return {
      point: key,
      label: formatter.format(date),
      visitors: row?.visitors ?? 0,
      sessions: row?.sessions ?? 0,
    };
  });
}

async function loadTraffic(
  siteId: string,
  from: Date,
  to: Date,
  filters: Filters,
  bucket: "hour" | "day",
  selectedDays: number,
) {
  const rows = await loadTrafficRows(siteId, from, to, filters, bucket);
  return completeTrafficSeries(rows, from, to, bucket, selectedDays);
}

async function loadDeviceBreakdown(
  siteId: string,
  from: Date,
  to: Date,
  filters: Filters,
) {
  const sql = db();
  return sql<{ value: string; sessions: number }[]>`
    ${filteredSessionsCte(sql, siteId, from, to, filters)}
    SELECT device AS value, COUNT(*)::int AS sessions
    FROM filtered_sessions
    GROUP BY value
    ORDER BY sessions DESC, value ASC
  `;
}

async function loadCountryBreakdown(
  siteId: string,
  from: Date,
  to: Date,
  filters: Filters,
) {
  const sql = db();
  return sql<{ value: string; sessions: number }[]>`
    ${filteredSessionsCte(sql, siteId, from, to, filters)}
    SELECT country AS value, COUNT(*)::int AS sessions
    FROM filtered_sessions
    GROUP BY value
    ORDER BY sessions DESC, value ASC
    LIMIT 15
  `;
}

async function loadFreshness(siteId: string) {
  const sql = db();
  const [row] = await sql<{ latestEventAt: Date | null }[]>`
    SELECT received_at AS "latestEventAt"
    FROM events
    WHERE site_id = ${siteId}
    ORDER BY received_at DESC LIMIT 1
  `;
  return row?.latestEventAt ?? null;
}

export async function getEnhancedDashboard(
  siteId: string,
  params: ExploreSearchParams = {},
) {
  const key = JSON.stringify([siteId, ...["range", "from", "to", "source", "landing", "exit", "keyEvent"].map(k => one(params[k]))]);
  return cachedReport(key, () => loadDashboard(siteId, params));
}

async function loadDashboard(siteId: string, params: ExploreSearchParams) {
  const range = resolveEnhancedRange(params);
  const baseRange = { from: range.from, to: range.to };
  // Base reports and comparisons share exactly the same event cutoff.
  return withSessionRollups(siteId, [baseRange, {from: range.comparisonFrom, to: range.comparisonTo}],
    () => loadEnhancedDashboard(siteId, params, range, baseRange.to));
}

async function loadEnhancedDashboard(siteId: string, params: ExploreSearchParams, range: ReturnType<typeof resolveEnhancedRange>, baseTo: Date) {
  const filters = filtersFrom(params);
  const base = await getExploreDashboard(siteId, baseParams(params, range), {from: range.from, to: baseTo});
  if (!base) return null;

  const [
    traffic,
    comparisonTraffic,
    comparisonSummary,
    devices,
    countries,
    latestEventAt,
  ] = await Promise.all([
    loadTraffic(
      siteId,
      range.from,
      baseTo,
      filters,
      range.bucket,
      range.selectedDays,
    ),
    loadTraffic(
      siteId,
      range.comparisonFrom,
      range.comparisonTo,
      filters,
      range.bucket,
      range.selectedDays,
    ),
    loadSummary(siteId, range.comparisonFrom, range.comparisonTo, filters),
    loadDeviceBreakdown(siteId, range.from, baseTo, filters),
    loadCountryBreakdown(siteId, range.from, baseTo, filters),
    loadFreshness(siteId),
  ]);

  return {
    ...base,
    range,
    traffic,
    comparison: {
      label: range.comparisonLabel,
      summary: comparisonSummary,
      traffic: comparisonTraffic,
    },
    devices,
    countries,
    latestEventAt,
  };
}

export async function getEnhancedJourneyExplorer(
  siteId: string,
  params: ExploreSearchParams = {},
  pageSize = 50,
) {
  const range = resolveEnhancedRange(params);
  const base = await getJourneyExplorer(
    siteId,
    baseParams(params, range),
    pageSize,
  );
  if (!base) return null;
  return { ...base, range };
}
