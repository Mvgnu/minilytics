import { getSitesOverview } from "./data";
import {
  getEnhancedDashboard,
  getEnhancedJourneyExplorer,
  type ExploreSearchParams,
} from "./enhanced-explore";

type ToolArguments = Record<string, unknown>;

const RANGE_ENUM = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "mtd",
  "90d",
  "custom",
];

function stringArg(args: ToolArguments, name: string, max = 2048) {
  const value = args[name];
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function integerArg(
  args: ToolArguments,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = Number(args[name]);
  return Number.isInteger(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function siteId(args: ToolArguments) {
  const value = stringArg(args, "site_id", 128);
  if (!value) throw new Error("site_id is required.");
  return value;
}

function exploreParams(args: ToolArguments): ExploreSearchParams {
  const range = stringArg(args, "range", 16) || "30d";
  if (!RANGE_ENUM.includes(range)) throw new Error("Unsupported range.");
  const params: ExploreSearchParams = { range };

  if (range === "custom") {
    const from = stringArg(args, "from", 10);
    const to = stringArg(args, "to", 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new Error("Custom ranges require from and to in YYYY-MM-DD format.");
    }
    params.from = from;
    params.to = to;
  }

  const source = stringArg(args, "source", 64).toLowerCase();
  const sourceDetail = stringArg(args, "source_detail", 256).toLowerCase();
  if (source) params.source = `${source}|${sourceDetail}`;

  const landing = stringArg(args, "landing_page", 2048);
  const exit = stringArg(args, "exit_page", 2048);
  if (landing) params.landing = landing;
  if (exit) params.exit = exit;

  const keyEvent = stringArg(args, "key_event", 80).toLowerCase();
  if (keyEvent === "yes" || keyEvent === "no") {
    params.keyEvent = keyEvent;
  } else if (keyEvent) {
    params.keyEvent = keyEvent.startsWith("event:")
      ? keyEvent
      : `event:${keyEvent}`;
  }

  return params;
}

const filterProperties = {
  range: {
    type: "string",
    enum: RANGE_ENUM,
    description: "Calendar range. Custom requires from and to.",
    default: "30d",
  },
  from: {
    type: "string",
    description: "Custom range start in YYYY-MM-DD.",
  },
  to: {
    type: "string",
    description: "Custom range end in YYYY-MM-DD.",
  },
  source: {
    type: "string",
    description: "Acquisition source, for example organic, direct, social or referral.",
  },
  source_detail: {
    type: "string",
    description: "Source detail, for example google, chatgpt or facebook.",
  },
  landing_page: {
    type: "string",
    description: "Exact landing path filter.",
  },
  exit_page: {
    type: "string",
    description: "Exact exit path filter.",
  },
  key_event: {
    type: "string",
    description: "yes, no, or a configured event name such as outbound.",
  },
} as const;

export const mcpTools = [
  {
    name: "minilytics_list_sites",
    title: "List Minilytics sites",
    description: "List all connected projects with their recent visitor and pageview totals.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "minilytics_overview",
    title: "Get analytics overview",
    description:
      "Get KPI totals, previous-period comparison, goals, top pages, acquisition, device/country splits and freshness for one site.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: { type: "string", description: "Minilytics site id." },
        ...filterProperties,
      },
      required: ["site_id"],
      additionalProperties: false,
    },
  },
  {
    name: "minilytics_traffic",
    title: "Get traffic time series",
    description:
      "Get aligned visitors and sessions time series for the selected and previous period. Single-day ranges are hourly.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: { type: "string", description: "Minilytics site id." },
        ...filterProperties,
      },
      required: ["site_id"],
      additionalProperties: false,
    },
  },
  {
    name: "minilytics_acquisition",
    title: "Analyze acquisition",
    description:
      "Get session acquisition, first-observed visitor acquisition, landing pages and exit pages for a site.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: { type: "string", description: "Minilytics site id." },
        ...filterProperties,
      },
      required: ["site_id"],
      additionalProperties: false,
    },
  },
  {
    name: "minilytics_content",
    title: "Analyze content and events",
    description:
      "Get top pages, key events, other actions, funnels and Core Web Vitals from already collected data.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: { type: "string", description: "Minilytics site id." },
        ...filterProperties,
      },
      required: ["site_id"],
      additionalProperties: false,
    },
  },
  {
    name: "minilytics_journeys",
    title: "Inspect visitor journeys",
    description:
      "Get a paginated set of complete matching session journeys with acquisition, landing/exit, engagement and events.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: { type: "string", description: "Minilytics site id." },
        ...filterProperties,
        page: { type: "integer", minimum: 1, description: "Journey page." },
        page_size: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: "Sessions per response, capped at 20.",
        },
      },
      required: ["site_id"],
      additionalProperties: false,
    },
  },
] as const;

function compactRange(data: NonNullable<Awaited<ReturnType<typeof getEnhancedDashboard>>>) {
  return {
    preset: data.range.preset,
    label: data.range.label,
    from: data.range.from.toISOString(),
    to: data.range.to.toISOString(),
    bucket: data.range.bucket,
  };
}

async function dashboard(args: ToolArguments) {
  const data = await getEnhancedDashboard(siteId(args), exploreParams(args));
  if (!data) throw new Error("Unknown site_id.");
  return data;
}

export async function callMcpTool(name: string, args: ToolArguments = {}) {
  if (name === "minilytics_list_sites") {
    return {
      period: "Last 30 days",
      sites: await getSitesOverview(30),
    };
  }

  if (name === "minilytics_journeys") {
    const page = integerArg(args, "page", 1, 1, 100_000);
    const pageSize = integerArg(args, "page_size", 10, 1, 20);
    const params = exploreParams(args);
    params.page = String(page);
    const data = await getEnhancedJourneyExplorer(siteId(args), params, pageSize);
    if (!data) throw new Error("Unknown site_id.");
    return {
      site: data.site,
      range: {
        preset: data.range.preset,
        label: data.range.label,
        from: data.range.from.toISOString(),
        to: data.range.to.toISOString(),
      },
      filters: data.filters,
      page: data.page,
      page_size: data.pageSize,
      total_pages: data.totalPages,
      total_sessions: data.totalSessions,
      journeys: data.journeys,
    };
  }

  const data = await dashboard(args);
  const common = {
    site: data.site,
    range: compactRange(data),
    filters: data.filters,
  };

  if (name === "minilytics_overview") {
    return {
      ...common,
      summary: data.summary,
      comparison: {
        label: data.comparison.label,
        summary: data.comparison.summary,
      },
      goals: data.goals,
      top_pages: data.pages,
      session_acquisition: data.sessionAcquisition,
      devices: data.devices,
      countries: data.countries,
      latest_event_at: data.latestEventAt,
    };
  }

  if (name === "minilytics_traffic") {
    return {
      ...common,
      current: data.traffic,
      previous: {
        label: data.comparison.label,
        points: data.comparison.traffic,
      },
    };
  }

  if (name === "minilytics_acquisition") {
    return {
      ...common,
      session_acquisition: data.sessionAcquisition,
      user_acquisition: data.userAcquisition,
      landing_pages: data.landingPages,
      exit_pages: data.exitPages,
    };
  }

  if (name === "minilytics_content") {
    return {
      ...common,
      pages: data.pages,
      goals: data.goals,
      events: data.events,
      funnels: data.funnels,
      web_vitals: data.webVitals,
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}
