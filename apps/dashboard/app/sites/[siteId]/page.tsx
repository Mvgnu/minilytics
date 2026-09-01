import Link from "next/link";
import { notFound } from "next/navigation";
import { getSiteDashboard } from "../../../lib/data";

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
  if (metric === "CLS") {
    return new Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(value);
  }
  return `${number(value)} ms`;
}

function TrafficChart({
  data,
}: {
  data: Array<{ day: string; visitors: number; pageviews: number }>;
}) {
  const max = Math.max(1, ...data.map((point) => point.visitors));

  return (
    <div className="chart" aria-label="Visitors by day">
      {data.map((point) => (
        <div
          className="barSlot"
          key={point.day}
          title={`${point.day}: ${point.visitors} visitors · ${point.pageviews} pageviews`}
        >
          <div
            className="bar"
            style={{ height: `${Math.max(4, (point.visitors / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function AcquisitionName({
  source,
}: {
  source: { source: string; detail: string | null; campaign: string | null };
}) {
  return (
    <span>
      {source.source}
      {source.detail || source.campaign ? (
        <small>{[source.detail, source.campaign].filter(Boolean).join(" · ")}</small>
      ) : null}
    </span>
  );
}

export default async function SitePage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const data = await getSiteDashboard(siteId, 30);
  if (!data) notFound();

  const goals = new Map(data.goals.map((goal) => [goal.eventType, goal]));

  return (
    <>
      <div className="backRow">
        <Link href="/">← All projects</Link>
      </div>

      <section className="hero siteHero">
        <div>
          <p className="eyebrow">Last 30 days</p>
          <h1>{data.site.name}</h1>
          <p className="lede">{data.site.domain}</p>
        </div>
      </section>

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
          <div><p className="eyebrow">Traffic</p><h2>Visitors</h2></div>
          <span className="muted">Engaged = 10s active, 2+ pageviews, or a key event</span>
        </div>
        {data.traffic.length ? <TrafficChart data={data.traffic} /> : <div className="empty">No traffic yet.</div>}
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
                  <span>{eventType}</span>
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
              <div className="tableRow fourCol" key={`${source.source}-${source.detail ?? ""}-${source.campaign ?? ""}`}>
                <AcquisitionName source={source} />
                <span>{number(source.engagedSessions)} engaged</span>
                <span>{number(source.keyEventSessions)} goals</span>
                <b>{number(source.sessions)}</b>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panelHeader"><div><p className="eyebrow">Acquisition · visitor scope</p><h2>User acquisition</h2></div></div>
          <p className="muted panelNote">First observed source for visitor IDs active in this period. Rotating network IDs limit how long this identity persists.</p>
          <div className="table">
            {data.userAcquisition.map((source) => (
              <div className="tableRow" key={`${source.source}-${source.detail ?? ""}-${source.campaign ?? ""}`}>
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
                <span className="truncate" title={page.path}>{page.path}</span>
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
                <span className="truncate" title={page.path}>{page.path}</span><span /><b>{number(page.exits)}</b>
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
        ) : <div className="empty">No Web Vitals samples yet.</div>}
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
          ) : <div className="empty">No click or custom events yet.</div>}
        </section>

        <section className="panel">
          <div className="panelHeader"><div><p className="eyebrow">Behavior</p><h2>Recent journeys</h2></div></div>
          {data.journeys.length ? (
            <div className="journeys">
              {data.journeys.map((journey) => (
                <article className="journey" key={journey.sessionId}>
                  <div className="journeyHead">
                    <span>{journey.source}{journey.detail ? ` · ${journey.detail}` : ""}</span>
                    <code>{journey.sessionId.slice(0, 8)}</code>
                  </div>
                  <ol>
                    {journey.events.slice(-8).map((event, index) => (
                      <li key={`${event.occurredAt}-${index}`}>
                        <time>{new Date(event.occurredAt).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}</time>
                        <span className="eventTag">{event.eventType}</span>
                        <span className="truncate">{event.targetLabel || event.targetUrl || event.path}</span>
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          ) : <div className="empty">No journeys yet.</div>}
        </section>
      </div>
    </>
  );
}
