import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardControls } from "./components/dashboard-controls";
import { TrafficChart } from "./components/traffic-chart";
import { getExploreDashboard, type ExploreSearchParams } from "../../../lib/explore";

export const dynamic = "force-dynamic";

function number(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}

function percent(value: number) {
  return `${number(value)}%`;
}

function duration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function vitalValue(metric: string, value: number) {
  if (metric === "CLS") return new Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(value);
  return `${number(value)} ms`;
}

function AcquisitionName({
  source,
}: {
  source: { source: string; medium: string; detail: string | null; campaign: string | null };
}) {
  return (
    <span>
      {source.source}
      {source.detail || source.medium || source.campaign ? (
        <small>{[source.detail, source.medium !== source.source ? source.medium : null, source.campaign].filter(Boolean).join(" · ")}</small>
      ) : null}
    </span>
  );
}

function queryFor(data: NonNullable<Awaited<ReturnType<typeof getExploreDashboard>>>) {
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

function hrefWith(
  siteId: string,
  data: NonNullable<Awaited<ReturnType<typeof getExploreDashboard>>>,
  patch: Partial<{ source: string; landing: string; exit: string; keyEvent: string }>,
) {
  const params = new URLSearchParams(queryFor(data));
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return `/sites/${siteId}?${params.toString()}`;
}

export default async function SitePage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<ExploreSearchParams>;
}) {
  const { siteId } = await params;
  const query = await searchParams;
  const data = await getExploreDashboard(siteId, query);
  if (!data) notFound();

  const goals = new Map(data.goals.map((goal) => [goal.eventType, goal]));
  const preservedQuery = queryFor(data);

  return (
    <>
      <div className="backRow">
        <Link href="/">← All projects</Link>
      </div>

      <section className="hero siteHero dashboardHero">
        <div>
          <p className="eyebrow">{data.range.label}</p>
          <h1>{data.site.name}</h1>
          <p className="lede">{data.site.domain}</p>
        </div>
        <Link className="secondaryButton" href={`/sites/${siteId}/journeys?${preservedQuery}`}>Explore journeys →</Link>
      </section>

      <DashboardControls range={data.range} filters={data.filters} options={data.filterOptions} />

      <section className="stats four">
        <article className="stat"><span>Visitors</span><strong>{number(data.summary.visitors)}</strong></article>
        <article className="stat"><span>Sessions</span><strong>{number(data.summary.sessions)}</strong></article>
        <article className="stat"><span>Engaged sessions</span><strong>{number(data.summary.engagedSessions)}</strong></article>
        <article className="stat"><span>Engagement rate</span><strong>{percent(data.summary.engagementRate)}</strong></article>
      </section>

      <section className="stats four">
        <article className="stat"><span>Pageviews</span><strong>{number(data.summary.pageviews)}</strong></article>
        <article className="stat"><span>Pages / session</span><strong>{number(data.summary.pagesPerSession)}</strong></article>
        <article className="stat"><span>Avg active engagement</span><strong>{duration(data.summary.avgEngagementMs)}</strong></article>
        <article className="stat"><span>Bounce rate</span><strong>{percent(data.summary.bounceRate)}</strong></article>
      </section>

      <section className="panel chartPanel">
        <div className="panelHeader">
          <div><p className="eyebrow">Traffic</p><h2>Visitors & sessions</h2></div>
          <span className="muted">Hover or tap a point for exact values</span>
        </div>
        {data.traffic.length ? <TrafficChart data={data.traffic} /> : <div className="empty">No traffic for this selection.</div>}
      </section>

      <div className="grid2">
        <section className="panel">
          <div className="panelHeader">
            <div><p className="eyebrow">Goals</p><h2>Key events</h2></div>
            <span className="muted">{percent(data.summary.keyEventRate)} of sessions</span>
          </div>
          <div className="table">
            {data.site.keyEvents.map((eventType) => {
              const goal = goals.get(eventType);
              return (
                <div className="tableRow" key={eventType}>
                  <span><Link className="drillLink" href={hrefWith(siteId, data, { keyEvent: `event:${eventType}` })}>{eventType}</Link></span>
                  <span>{number(goal?.sessions ?? 0)} sessions</span>
                  <b>{number(goal?.count ?? 0)}</b>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panelHeader"><div><p className="eyebrow">Content</p><h2>Top pages</h2></div></div>
          <div className="table">
            {data.pages.map((page) => (
              <div className="tableRow" key={page.path}>
                <span className="truncate" title={page.path}>{page.path}<small>{duration(page.avgEngagementMs)} avg active</small></span>
                <span>{number(page.visitors)} visitors · {number(page.clicks)} clicks</span>
                <b>{number(page.views)}</b>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid2">
        <section className="panel">
          <div className="panelHeader"><div><p className="eyebrow">Acquisition · session scope</p><h2>Session acquisition</h2></div></div>
          <div className="table">
            {data.sessionAcquisition.map((source) => (
              <div className="tableRow fourCol" key={`${source.source}-${source.medium}-${source.detail ?? ""}-${source.campaign ?? ""}`}>
                <Link className="drillLink" href={hrefWith(siteId, data, { source: `${source.source}|${source.detail ?? ""}` })}><AcquisitionName source={source} /></Link>
                <span>{number(source.engagedSessions)} engaged</span>
                <span>{number(source.keyEventSessions)} goals</span>
                <b>{number(source.sessions)}</b>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panelHeader"><div><p className="eyebrow">Acquisition · visitor scope</p><h2>User acquisition</h2></div></div>
          <p className="muted panelNote">First observed source for visitor IDs active in this selection. Rotating network IDs limit how long this identity persists.</p>
          <div className="table">
            {data.userAcquisition.map((source) => (
              <div className="tableRow" key={`${source.source}-${source.medium}-${source.detail ?? ""}-${source.campaign ?? ""}`}>
                <AcquisitionName source={source} /><span /><b>{number(source.visitors)}</b>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid2">
        <section className="panel">
          <div className="panelHeader"><div><p className="eyebrow">Entry</p><h2>Landing pages</h2></div></div>
          <div className="table">
            {data.landingPages.map((page) => (
              <div className="tableRow fourCol" key={page.path}>
                <span className="truncate" title={page.path}><Link className="drillLink" href={hrefWith(siteId, data, { landing: page.path })}>{page.path}</Link></span>
                <span>{percent(page.sessions ? (100 * page.engagedSessions) / page.sessions : 0)} engaged</span>
                <span>{number(page.keyEventSessions)} goals</span>
                <b>{number(page.sessions)}</b>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panelHeader"><div><p className="eyebrow">Exit</p><h2>Exit pages</h2></div></div>
          <div className="table">
            {data.exitPages.map((page) => (
              <div className="tableRow" key={page.path}>
                <span className="truncate" title={page.path}><Link className="drillLink" href={hrefWith(siteId, data, { exit: page.path })}>{page.path}</Link></span><span /><b>{number(page.exits)}</b>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panelHeader"><div><p className="eyebrow">Behavior</p><h2>Funnels</h2></div></div>
        <div className="funnels">
          {data.funnels.map((funnel) => {
            const first = funnel.steps[0]?.count || 0;
            return (
              <article className="funnel" key={funnel.id}>
                <h3>{funnel.name}</h3>
                <div className="funnelSteps">
                  {funnel.steps.map((step, index) => {
                    const previous = funnel.steps[index - 1]?.count ?? step.count;
                    const stepRate = previous ? (100 * step.count) / previous : 0;
                    const totalRate = first ? (100 * step.count) / first : 0;
                    return (
                      <div className="funnelStep" key={`${funnel.id}-${index}`}>
                        <span>{step.name}</span><strong>{number(step.count)}</strong>
                        <small>{index === 0 ? "100% start" : `${percent(stepRate)} from previous · ${percent(totalRate)} overall`}</small>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div><p className="eyebrow">Experience</p><h2>Web Vitals · p75</h2></div>
          <span className="muted">LCP · INP · CLS · FCP · TTFB</span>
        </div>
        {data.webVitals.length ? (
          <div className="vitalGrid">
            {data.webVitals.map((vital) => (
              <article className="vital" key={vital.metric}>
                <span>{vital.metric}</span><strong>{vitalValue(vital.metric, vital.p75)}</strong>
                <small>{percent(vital.goodPercent)} good · n={number(vital.samples)}</small>
              </article>
            ))}
          </div>
        ) : <div className="empty">No Web Vitals samples for this selection.</div>}
      </section>

      <div className="grid2">
        <section className="panel">
          <div className="panelHeader">
            <div><p className="eyebrow">Actions</p><h2>Events</h2></div>
            <span className="muted">{number(data.summary.trackedEvents)} total</span>
          </div>
          {data.events.length ? (
            <div className="table">
              {data.events.map((event) => (
                <div className="tableRow" key={event.eventType}>
                  <span>{event.eventType}</span>
                  <span>{data.site.keyEvents.includes(event.eventType) ? "key event" : ""}</span>
                  <b>{number(event.count)}</b>
                </div>
              ))}
            </div>
          ) : <div className="empty">No click or custom events for this selection.</div>}
        </section>

        <section className="panel">
          <div className="panelHeader">
            <div><p className="eyebrow">Behavior</p><h2>Recent journeys</h2></div>
            <Link className="panelLink" href={`/sites/${siteId}/journeys?${preservedQuery}`}>View all →</Link>
          </div>
          {data.journeys.length ? (
            <div className="journeys">
              {data.journeys.map((journey) => (
                <article className="journey" key={journey.sessionId}>
                  <div className="journeyHead">
                    <span>
                      {journey.source}
                      {journey.detail ? ` · ${journey.detail}` : ""}
                      {journey.medium && journey.medium !== journey.source ? ` / ${journey.medium}` : ""}
                    </span>
                    <code>{journey.sessionId.slice(0, 8)}</code>
                  </div>
                  <ol>
                    {journey.events.slice(-8).map((event, index) => (
                      <li key={`${event.occurredAt}-${index}`}>
                        <time>{new Date(event.occurredAt).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}</time>
                        <span className="eventTag">{event.eventType}</span>
                        <span className="truncate">{event.targetLabel || event.targetUrl || event.path}</span>
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          ) : <div className="empty">No journeys for this selection.</div>}
        </section>
      </div>
    </>
  );
}
