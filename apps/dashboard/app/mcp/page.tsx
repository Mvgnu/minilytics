export const dynamic = "force-dynamic";

const TOOLS = [
  "minilytics_list_sites",
  "minilytics_overview",
  "minilytics_traffic",
  "minilytics_acquisition",
  "minilytics_content",
  "minilytics_journeys",
];

export default function McpPage() {
  const publicUrl = process.env.MINILYTICS_PUBLIC_URL?.replace(/\/$/, "") || "https://analytics.example.com";
  const configured = Boolean(
    process.env.MINILYTICS_PUBLIC_URL &&
      (process.env.MINILYTICS_OAUTH_SECRET || process.env.DASHBOARD_PASSWORD),
  );

  return (
    <>
      <section className="hero siteHero">
        <div>
          <p className="eyebrow">Remote MCP · OAuth</p>
          <h1>Connect Minilytics</h1>
          <p className="lede">
            Read-only access to the analytics already stored in this dashboard.
            No changes are required on tracked sites.
          </p>
        </div>
      </section>

      <section className="stats four">
        <article className="stat">
          <span>Status</span>
          <strong>{configured ? "Ready" : "Setup"}</strong>
        </article>
        <article className="stat">
          <span>Transport</span>
          <strong>HTTP</strong>
        </article>
        <article className="stat">
          <span>Authorization</span>
          <strong>OAuth</strong>
        </article>
        <article className="stat">
          <span>Scope</span>
          <strong>Read</strong>
        </article>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Connector URL</p>
            <h2>{publicUrl}/api/mcp</h2>
          </div>
        </div>
        <p className="muted panelNote">
          Add this URL as a remote MCP server. The client discovers the OAuth
          endpoints automatically, registers a public PKCE client, and opens the
          owner approval screen. The approval screen uses the same admin password
          as the dashboard.
        </p>
        {!configured ? (
          <div className="empty">
            Set <code>MINILYTICS_PUBLIC_URL</code> and a strong
            <code> MINILYTICS_OAUTH_SECRET</code>, then run the database migrations.
          </div>
        ) : null}
      </section>

      <div className="grid2">
        <section className="panel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Permissions</p>
              <h2>Read-only by design</h2>
            </div>
          </div>
          <p className="muted panelNote">
            The OAuth scope is <code>analytics:read</code>. MCP tools cannot create,
            edit or delete sites, events, goals, funnels or credentials.
          </p>
        </section>

        <section className="panel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Available tools</p>
              <h2>Analytics reports</h2>
            </div>
          </div>
          <div className="table">
            {TOOLS.map((tool) => (
              <div className="tableRow" key={tool}>
                <code>{tool}</code>
                <span />
                <b>read</b>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Production checklist</p>
            <h2>Before connecting</h2>
          </div>
        </div>
        <div className="table">
          <div className="tableRow"><span>HTTPS public dashboard URL</span><span /><b>required</b></div>
          <div className="tableRow"><span>Run <code>npm run db:migrate</code></span><span /><b>required</b></div>
          <div className="tableRow"><span>Set a strong dashboard password</span><span /><b>required</b></div>
          <div className="tableRow"><span>Set a separate OAuth signing secret</span><span /><b>recommended</b></div>
        </div>
      </section>
    </>
  );
}
