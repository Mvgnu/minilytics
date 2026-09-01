import Link from "next/link";
import { notFound } from "next/navigation";
import { getSiteDashboard } from "../../../lib/data";

export const dynamic = "force-dynamic";

function number(value: number) {
  return new Intl.NumberFormat("en").format(value);
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
        <div className="barSlot" key={point.day} title={`${point.day}: ${point.visitors} visitors`}>
          <div
            className="bar"
            style={{ height: `${Math.max(4, (point.visitors / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
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
        <article className="stat">
          <span>Visitors</span>
          <strong>{number(data.summary.visitors)}</strong>
        </article>
        <article className="stat">
          <span>Sessions</span>
          <strong>{number(data.summary.sessions)}</strong>
        </article>
        <article className="stat">
          <span>Pageviews</span>
          <strong>{number(data.summary.pageviews)}</strong>
        </article>
        <article className="stat">
          <span>Tracked events</span>
          <strong>{number(data.summary.trackedEvents)}</strong>
        </article>
      </section>

      <section className="panel chartPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Traffic</p>
            <h2>Visitors</h2>
          </div>
        </div>
        {data.traffic.length ? (
          <TrafficChart data={data.traffic} />
        ) : (
          <div className="empty">No traffic yet.</div>
        )}
      </section>

      <div className="grid2">
        <section className="panel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Content</p>
              <h2>Top pages</h2>
            </div>
          </div>
          <div className="table">
            {data.pages.map((page) => (
              <div className="tableRow" key={page.path}>
                <span className="truncate" title={page.path}>
                  {page.path}
                </span>
                <span>{number(page.visitors)} visitors · {number(page.clicks)} clicks</span>
                <b>{number(page.views)}</b>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Acquisition</p>
              <h2>Sources</h2>
            </div>
          </div>
          <div className="table">
            {data.sources.map((source) => (
              <div
                className="tableRow"
                key={`${source.source}-${source.detail ?? ""}-${source.campaign ?? ""}`}
              >
                <span>
                  {source.source}
                  {source.detail || source.campaign ? (
                    <small>
                      {[source.detail, source.campaign].filter(Boolean).join(" · ")}
                    </small>
                  ) : null}
                </span>
                <span />
                <b>{number(source.sessions)}</b>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid2">
        <section className="panel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Actions</p>
              <h2>Events</h2>
            </div>
          </div>
          {data.events.length ? (
            <div className="table">
              {data.events.map((event) => (
                <div className="tableRow" key={event.eventType}>
                  <span>{event.eventType}</span>
                  <span />
                  <b>{number(event.count)}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">No click or custom events yet.</div>
          )}
        </section>

        <section className="panel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Behavior</p>
              <h2>Recent journeys</h2>
            </div>
          </div>
          {data.journeys.length ? (
            <div className="journeys">
              {data.journeys.map((journey) => (
                <article className="journey" key={journey.sessionId}>
                  <div className="journeyHead">
                    <span>
                      {journey.source}
                      {journey.detail ? ` · ${journey.detail}` : ""}
                    </span>
                    <code>{journey.sessionId.slice(0, 8)}</code>
                  </div>
                  <ol>
                    {journey.events.slice(-8).map((event, index) => (
                      <li key={`${event.occurredAt}-${index}`}>
                        <time>
                          {new Date(event.occurredAt).toLocaleTimeString("en", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                        <span className="eventTag">{event.eventType}</span>
                        <span className="truncate">
                          {event.targetLabel || event.targetUrl || event.path}
                        </span>
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty">No journeys yet.</div>
          )}
        </section>
      </div>
    </>
  );
}
