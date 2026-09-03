import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardControls } from "../components/dashboard-controls";
import { getJourneyExplorer, type ExploreSearchParams } from "../../../../lib/explore";

export const dynamic = "force-dynamic";

function duration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function buildQuery(data: NonNullable<Awaited<ReturnType<typeof getJourneyExplorer>>>, page?: number) {
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
  if (page && page > 1) params.set("page", String(page));
  return params.toString();
}

export default async function JourneysPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<ExploreSearchParams>;
}) {
  const { siteId } = await params;
  const query = await searchParams;
  const data = await getJourneyExplorer(siteId, query);
  if (!data) notFound();

  const overviewQuery = buildQuery(data);

  return (
    <>
      <div className="backRow">
        <Link href={`/sites/${siteId}?${overviewQuery}`}>← Dashboard</Link>
      </div>

      <section className="hero siteHero dashboardHero">
        <div>
          <p className="eyebrow">Journey explorer · {data.range.label}</p>
          <h1>{data.site.name}</h1>
          <p className="lede">{data.totalSessions.toLocaleString("en")} matching sessions · newest first</p>
        </div>
      </section>

      <DashboardControls range={data.range} filters={data.filters} options={data.filterOptions} />

      <section className="panel journeyExplorerPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Behavior</p>
            <h2>All recorded journeys</h2>
          </div>
          <span className="muted">Page {data.page} / {data.totalPages}</span>
        </div>

        {data.journeys.length ? (
          <div className="journeys journeyExplorer">
            {data.journeys.map((journey) => (
              <article className="journey journeyFull" key={journey.sessionId}>
                <div className="journeyHead journeyHeadRich">
                  <div>
                    <strong>{journey.source}{journey.detail ? ` · ${journey.detail}` : ""}</strong>
                    <span>{journey.medium}{journey.campaign ? ` · ${journey.campaign}` : ""}</span>
                  </div>
                  <div className="journeyMeta">
                    <span>{duration(journey.engagementMs)} active</span>
                    {journey.keyEvents.length ? <span className="goalPill">{journey.keyEvents.join(", ")}</span> : <span>No key event</span>}
                    <code>{journey.sessionId.slice(0, 12)}</code>
                  </div>
                </div>

                <div className="journeyRoute">
                  <span title={journey.landingPath ?? "No pageview"}>↳ {journey.landingPath ?? "No landing page"}</span>
                  <span>→</span>
                  <span title={journey.exitPath ?? "No pageview"}>↲ {journey.exitPath ?? "No exit page"}</span>
                </div>

                <ol>
                  {journey.events.map((event, index) => (
                    <li key={`${event.occurredAt}-${index}`}>
                      <time>
                        {new Date(event.occurredAt).toLocaleString("en", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      <span className="eventTag">{event.eventType}</span>
                      <span className="truncate" title={event.targetLabel || event.targetUrl || event.path}>
                        {event.targetLabel || event.targetUrl || event.path}
                      </span>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">No journeys match this selection.</div>
        )}

        {data.totalPages > 1 ? (
          <nav className="pagination" aria-label="Journey pages">
            {data.page > 1 ? <Link href={`?${buildQuery(data, data.page - 1)}`}>← Previous</Link> : <span />}
            <span>{data.totalSessions.toLocaleString("en")} sessions</span>
            {data.page < data.totalPages ? <Link href={`?${buildQuery(data, data.page + 1)}`}>Next →</Link> : <span />}
          </nav>
        ) : null}
      </section>
    </>
  );
}
