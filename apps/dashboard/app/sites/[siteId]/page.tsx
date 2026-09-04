import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardControlsV2 } from "./components/dashboard-controls-v2";
import { TrafficChartV2 } from "./components/traffic-chart-v2";
import styles from "./components/analytics-v2.module.css";
import {
  getEnhancedDashboard,
  type ExploreSearchParams,
} from "../../../lib/enhanced-explore";

export const dynamic = "force-dynamic";

type DashboardData = NonNullable<Awaited<ReturnType<typeof getEnhancedDashboard>>>;

function number(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}
function percent(value: number) { return `${number(value)}%`; }
function duration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function change(current: number, previous: number) {
  if (!previous) return current ? "New" : "No change";
  const value = ((current - previous) / previous) * 100;
  return `${value > 0 ? "+" : ""}${number(value)}%`;
}
function vitalValue(metric: string, value: number) {
  if (metric === "CLS") return new Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(value);
  return `${number(value)} ms`;
}

function MetricCard({ label, value, current, previous }: { label: string; value: string; current: number; previous: number }) {
  return (
    <article className="stat">
      <span>{label}</span>
      <div>
        <strong>{value}</strong>
        <small className={styles.metricDelta}>{change(current, previous)} vs previous</small>
      </div>
    </article>
  );
}

function AcquisitionName({ source }: { source: { source: string; medium: string; detail: string | null; campaign: string | null } }) {
  return (
    <span>
      {source.source}
      {source.detail || source.medium || source.campaign ? (
        <small>{[source.detail, source.medium !== source.source ? source.medium : null, source.campaign].filter(Boolean).join(" · ")}</small>
      ) : null}
    </span>
  );
}

function queryFor(data: DashboardData) {
  const params = new URLSearchParams();
  params.set("range", data.range.preset);
  if (data.range.preset === "custom") {
    params.set("from", data.range.fromInput);
    params.set("to", data.range.toInput);
  }
  if (data.filters.source) params.set("source", data.filters.source);
  if (data.filters.landing) params.set("landing", data.filters.landing);
  if (data.filters.exit) params.set("exit", data.filters.exit);
  if (data.filters.keyEvent) params.set("keyEvent", data.filters.keyEvent);
  return params.toString();
}

function hrefWith(siteId: string, data: DashboardData, patch: Partial<{ source: string; landing: string; exit: string; keyEvent: string }>) {
  const params = new URLSearchParams(queryFor(data));
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return `/sites/${siteId}?${params.toString()}`;
}

function DimensionList({ rows }: { rows: Array<{ value: string; sessions: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.sessions));
  if (!rows.length) return <div className="empty">No dimension data for this selection.</div>;
  return (
    <div className={styles.dimensionList}>
      {rows.map((row) => (
        <div className={styles.dimensionRow} key={row.value}>
          <span title={row.value}>{row.value}</span>
          <span className={styles.dimensionTrack} aria-hidden="true"><i style={{ width: `${(row.sessions / max) * 100}%` }} /></span>
          <b>{number(row.sessions)}</b>
        </div>
      ))}
    </div>
  );
}

export default async function SitePage({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<ExploreSearchParams> }) {
  const { siteId } = await params;
  const query = await searchParams;
  const data = await getEnhancedDashboard(siteId, query);
  if (!data) notFound();

  const goals = new Map(data.goals.map((goal) => [goal.eventType, goal]));
  const preservedQuery = queryFor(data);
  const previous = data.comparison.summary;
  const freshness = data.latestEventAt
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(data.latestEventAt))
    : null;

  return (
    <>
      <div className="backRow"><Link href="/">← All projects</Link></div>

      <section className="hero siteHero dashboardHero">
        <div>
          <p className="eyebrow">{data.range.label}</p>
          <h1>{data.site.name}</h1>
          <p className="lede">{data.site.domain}</p>
          <p className={styles.freshness}>
            {freshness ? `Latest event ${freshness} UTC` : "No events received yet"}
            {` · compared with ${data.comparison.label}`}
          </p>
        </div>
        <Link className="secondaryButton" href={`/sites/${siteId}/journeys?${preservedQuery}`}>Explore journeys →</Link>
      </section>

      <DashboardControlsV2 range={data.range} filters={data.filters} options={data.filterOptions} />

      <section className="stats four">
        <MetricCard label="Visitors" value={number(data.summary.visitors)} current={data.summary.visitors} previous={previous.visitors} />
        <MetricCard label="Sessions" value={number(data.summary.sessions)} current={data.summary.sessions} previous={previous.sessions} />
        <MetricCard label="Engaged sessions" value={number(data.summary.engagedSessions)} current={data.summary.engagedSessions} previous={previous.engagedSessions} />
        <MetricCard label="Engagement rate" value={percent(data.summary.engagementRate)} current={data.summary.engagementRate} previous={previous.engagementRate} />
      </section>
      <section className="stats four">
        <MetricCard label="Pageviews" value={number(data.summary.pageviews)} current={data.summary.pageviews} previous={previous.pageviews} />
        <MetricCard label="Pages / session" value={number(data.summary.pagesPerSession)} current={data.summary.pagesPerSession} previous={previous.pagesPerSession} />
        <MetricCard label="Avg active engagement" value={duration(data.summary.avgEngagementMs)} current={data.summary.avgEngagementMs} previous={previous.avgEngagementMs} />
        <MetricCard label="Bounce rate" value={percent(data.summary.bounceRate)} current={data.summary.bounceRate} previous={previous.bounceRate} />
      </section>

      <section className="panel chartPanel">
        <div className="panelHeader"><div><p className="eyebrow">Traffic</p><h2>Visitors & sessions</h2></div><span className="muted">Hover or tap for exact values</span></div>
        {data.traffic.length ? <TrafficChartV2 data={data.traffic} comparison={data.comparison.traffic} comparisonLabel={data.comparison.label} /> : <div className="empty">No traffic for this selection.</div>}
      </section>

      <div className="grid2">
        <section className="panel">
          <div className="panelHeader"><div><p className="eyebrow">Goals</p><h2>Key events</h2></div><span className="muted">{percent(data.summary.keyEventRate)} of sessions</span></div>
          <div className="table">
            {data.site.keyEvents.map((eventType) => {
              const goal = goals.get(eventType);
              return <div className="tableRow" key={eventType}><span><Link className="drillLink" href={hrefWith(siteId, data, { keyEvent: `event:${eventType}` })}>{eventType}</Link></span><span>{number(goal?.sessions ?? 0)} sessions</span><b>{number(goal?.count ?? 0)}</b></div>;
            })}
          </div>
        </section>
        <section className="panel">
          <div className="panelHeader"><div><p className="eyebrow">Content</p><h2>Top pages</h2></div></div>
          <div className="table">
            {data.pages.map((page) => <div className="tableRow" key={page.path}><span className="truncate" title={page.path}>{page.path}<small>{duration(page.avgEngagementMs)} avg active</small></span><span>{number(page.visitors)} visitors · {number(page.clicks)} clicks</span><b>{number(page.views)}</b></div>)}
          </div>
        </section>
      </div>

      <div className="grid2">
        <section className="panel">
          <div className="panelHeader"><div><p className="eyebrow">Acquisition · session scope</p><h2>Session acquisition</h2></div></div>
          <div className="table">
            {data.sessionAcquisition.map((source) => <div className="tableRow fourCol" key={`${source.source}-${source.medium}-${source.detail ?? ""}-${source.campaign ?? ""}`}><Link className="drillLink" href={hrefWith(siteId, data, { source: `${source.source}|${source.detail ?? ""}` })}><AcquisitionName source={source} /></Link><span>{number(source.engagedSessions)} engaged</span><span>{number(source.keyEventSessions)} goals</span><b>{number(source.sessions)}</b></div>)}
          </div>
        </section>
        <section className="panel">
          <div className="panelHeader"><div><p className="eyebrow">Acquisition · visitor scope</p><h2>User acquisition</h2></div></div>
          <p className="muted panelNote">First observed source for visitor IDs active in this selection. Rotating network IDs limit how long this identity persists.</p>
          <div className="table">
            {data.userAcquisition.map((source) => <div className="tableRow" key={`${source.source}-${source.medium}-${source.detail ?? ""}-${source.campaign ?? ""}`}><AcquisitionName source={source} /><span /><b>{number(source.visitors)}</b></div>)}
          </div>
        </section>
      </div>

      <div className="grid2">
        <section className="panel"><div className="panelHeader"><div><p className="eyebrow">Audience</p><h2>Devices</h2></div></div><DimensionList rows={data.devices} /></section>
        <section className="panel"><div className="panelHeader"><div><p className="eyebrow">Geography</p><h2>Countries</h2></div></div><DimensionList rows={data.countries} /></section>
      </div>

      <div className="grid2">
        <section className="panel">
          <div className="panelHeader"><div><p className="eyebrow">Entry</p><h2>Landing pages</h2></div></div>
          <div className="table">
            {data.landingPages.map((page) => <div className="tableRow fourCol" key={page.path}><span className="truncate" title={page.path}><Link className="drillLink" href={hrefWith(siteId, data, { landing: page.path })}>{page.path}</Link></span><span>{percent(page.sessions ? (100 * page.engagedSessions) / page.sessions : 0)} engaged</span><span>{number(page.keyEventSessions)} goals</span><b>{number(page.sessions)}</b></div>)}
          </div>
        </section>
        <section className="panel">
          <div className="panelHeader"><div><p className="eyebrow">Exit</p><h2>Exit pages</h2></div></div>
          <div className="table">
            {data.exitPages.map((page) => <div className="tableRow" key={page.path}><span className="truncate" title={page.path}><Link className="drillLink" href={hrefWith(siteId, data, { exit: page.path })}>{page.path}</Link></span><span /><b>{number(page.exits)}</b></div>)}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panelHeader"><div><p className="eyebrow">Behavior</p><h2>Funnels</h2></div></div>
        <div className="funnels">
          {data.funnels.map((funnel) => {
            const first = funnel.steps[0]?.count || 0;
            return <article className="funnel" key={funnel.id}><h3>{funnel.name}</h3><div className="funnelSteps">{funnel.steps.map((step, index) => {
              const prior = funnel.steps[index - 1]?.count ?? step.count;
              const stepRate = prior ? (100 * step.count) / prior : 0;
              const totalRate = first ? (100 * step.count) / first : 0;
              return <div className="funnelStep" key={`${funnel.id}-${index}`}><span>{step.name}</span><strong>{number(step.count)}</strong><small>{index === 0 ? "100% start" : `${percent(stepRate)} from previous · ${percent(totalRate)} overall`}</small></div>;
            })}</div></article>;
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader"><div><p className="eyebrow">Experience</p><h2>Web Vitals · p75</h2></div><span className="muted">LCP · INP · CLS · FCP · TTFB</span></div>
        {data.webVitals.length ? <div className="vitalGrid">{data.webVitals.map((vital) => <article className="vital" key={vital.metric}><span>{vital.metric}</span><strong>{vitalValue(vital.metric, vital.p75)}</strong><small>{percent(vital.goodPercent)} good · n={number(vital.samples)}</small></article>)}</div> : <div className="empty">No Web Vitals samples for this selection.</div>}
      </section>

      <div className="grid2">
        <section className="panel">
          <div className="panelHeader"><div><p className="eyebrow">Actions</p><h2>Events</h2></div><span className="muted">{number(data.summary.trackedEvents)} total</span></div>
          {data.events.length ? <div className="table">{data.events.map((event) => <div className="tableRow" key={event.eventType}><span>{event.eventType}</span><span>{data.site.keyEvents.includes(event.eventType) ? "key event" : ""}</span><b>{number(event.count)}</b></div>)}</div> : <div className="empty">No click or custom events for this selection.</div>}
        </section>
        <section className="panel">
          <div className="panelHeader"><div><p className="eyebrow">Behavior</p><h2>Recent journeys</h2></div><Link className="panelLink" href={`/sites/${siteId}/journeys?${preservedQuery}`}>View all →</Link></div>
          {data.journeys.length ? <div className="journeys">{data.journeys.map((journey) => <article className="journey" key={journey.sessionId}><div className="journeyHead"><span>{journey.source}{journey.detail ? ` · ${journey.detail}` : ""}{journey.medium && journey.medium !== journey.source ? ` / ${journey.medium}` : ""}</span><code>{journey.sessionId.slice(0, 8)}</code></div><ol>{journey.events.slice(-8).map((event, index) => <li key={`${event.occurredAt}-${index}`}><time>{new Date(event.occurredAt).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}</time><span className="eventTag">{event.eventType}</span><span className="truncate">{event.targetLabel || event.targetUrl || event.path}</span></li>)}</ol></article>)}</div> : <div className="empty">No journeys for this selection.</div>}
        </section>
      </div>
    </>
  );
}
