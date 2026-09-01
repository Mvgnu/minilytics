import Link from "next/link";
import { getSitesOverview } from "../lib/data";

export const dynamic = "force-dynamic";

function number(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

export default async function Home() {
  const sites = await getSitesOverview(30);
  const totals = sites.reduce(
    (sum, site) => ({
      visitors: sum.visitors + site.visitors,
      pageviews: sum.pageviews + site.pageviews,
      events: sum.events + site.events,
    }),
    { visitors: 0, pageviews: 0, events: 0 },
  );

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Last 30 days</p>
          <h1>All projects</h1>
          <p className="lede">
            Traffic, acquisition and useful actions without sending the browser to
            somebody else&apos;s analytics domain.
          </p>
        </div>
      </section>

      <section className="stats">
        <article className="stat">
          <span>Visitors</span>
          <strong>{number(totals.visitors)}</strong>
        </article>
        <article className="stat">
          <span>Pageviews</span>
          <strong>{number(totals.pageviews)}</strong>
        </article>
        <article className="stat">
          <span>All events</span>
          <strong>{number(totals.events)}</strong>
        </article>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Projects</p>
            <h2>Sites</h2>
          </div>
          <span className="muted">{sites.length} configured</span>
        </div>

        {sites.length ? (
          <div className="siteList">
            {sites.map((site) => (
              <Link className="siteRow" href={`/sites/${site.id}`} key={site.id}>
                <div>
                  <strong>{site.name}</strong>
                  <span>{site.domain}</span>
                </div>
                <div className="siteMetrics">
                  <span>
                    <b>{number(site.visitors)}</b> visitors
                  </span>
                  <span>
                    <b>{number(site.pageviews)}</b> views
                  </span>
                </div>
                <span className="arrow">→</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty">
            <strong>No sites yet.</strong>
            <span>
              Run <code>npm run site:create -- --id ...</code> to create the first
              one.
            </span>
          </div>
        )}
      </section>
    </>
  );
}
