# Minilytics

Tiny first-party analytics for sites you own.

```text
visitor
  -> https://your-site.example/api/minilytics
  -> same-origin server proxy
  -> https://analytics.example.com/api/collect
  -> Postgres
  -> Minilytics dashboard / OAuth MCP
```

The browser never loads an external analytics script, pixel or cookie domain. The central collector is contacted server-to-server.

## What it tracks

- pageviews and SPA navigation
- direct, organic search, organic AI discovery, social, referral and UTM attribution
- automatic clicks, outbound clicks, downloads and form submissions without form values
- custom business events and configurable key events
- rotating first-party visitor estimates and session journeys
- active visible-tab engagement, engaged sessions and bounce rate
- source, landing, exit and key-event filters
- visitors + sessions line graphs with previous-period comparison
- hourly traffic for Today, Yesterday and any one-day custom range
- Today / Yesterday / 7 days / 30 days / month-to-date / 90 days / custom date ranges
- landing pages, exit pages, funnels, device and country breakdowns
- LCP, INP, CLS, FCP and TTFB at p75
- a paginated journey explorer
- a read-only remote MCP server with OAuth 2.1-style PKCE authorization

No dashboard-only feature in this repository requires a tracker change on already integrated external sites.

## Run the dashboard

Requirements: Node 20.9+ and Postgres.

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run dev
```

Production settings:

```env
DATABASE_URL=postgres://...
DASHBOARD_PASSWORD=a-strong-admin-password
MINILYTICS_PUBLIC_URL=https://analytics.example.com
MINILYTICS_OAUTH_SECRET=a-separate-long-random-secret
```

`MINILYTICS_PUBLIC_URL` must be the canonical public origin used to reach the dashboard. OAuth access tokens are bound to `${MINILYTICS_PUBLIC_URL}/api/mcp`, so proxy aliases or mismatched origins are rejected.

The dashboard uses HTTP Basic auth. The event collector, OAuth discovery/registration/token endpoints and bearer-protected MCP endpoint are public protocol endpoints; the OAuth approval screen remains behind the dashboard password.

## Register a tracked site

```bash
npm run site:create -- \
  --id preiswert-leasen \
  --name "Preiswert Leasen" \
  --domain preiswert-leasen.de
```

The command prints:

```text
MINILYTICS_SITE_ID=preiswert-leasen
MINILYTICS_SITE_SECRET=...
```

The site secret is stored centrally only as SHA-256 and printed once. Put it in the tracked site's server-side environment.

## Add Minilytics to a Next.js site

```env
MINILYTICS_COLLECTOR_URL=https://analytics.example.com/api/collect
MINILYTICS_SITE_ID=preiswert-leasen
MINILYTICS_SITE_SECRET=the-secret-from-site-create
```

Create one same-origin route:

```ts
// app/api/minilytics/route.ts
import { createMinilyticsProxy } from "@mvgnu/minilytics/server";

export const POST = createMinilyticsProxy({
  collectorUrl: process.env.MINILYTICS_COLLECTOR_URL!,
  siteId: process.env.MINILYTICS_SITE_ID!,
  siteSecret: process.env.MINILYTICS_SITE_SECRET!,
});
```

Add one component to the root layout:

```tsx
import { Analytics } from "@mvgnu/minilytics/client";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

That is the complete browser integration. Query strings are stripped from stored paths and clicked URLs; UTM attribution is extracted separately.

### Proxy options

```ts
createMinilyticsProxy({
  collectorUrl,
  siteId,
  siteSecret,
  networkVisitors: true,
  visitorRotationHours: 24,
  filterBots: true,
});
```

The default same-origin proxy derives a daily site-scoped visitor estimate:

```text
HMAC(site secret, site id + rotation bucket + IP address + User-Agent)
```

The raw IP address is never sent to the central collector or stored in Postgres. A daily rotating identifier intentionally trades cross-day identity for less persistent tracking, so multi-day visitor totals are privacy-oriented estimates rather than a count of identifiable humans.

### Mark important actions

```tsx
<a href={offer.url} data-minilytics="leasing-offer">
  Zum Angebot
</a>

<form data-minilytics="lead-form">...</form>
```

No input values are captured.

Custom events:

```ts
window.minilytics?.track("lead", {
  provider: "leasingmarkt",
});
```

Custom properties are capped at 4 KB.

## Goals and funnels

Configure key events:

```bash
npm run site:goals -- --id preiswert-leasen --events outbound,lead
```

Configure an ordered funnel:

```bash
npm run site:funnel -- \
  --id preiswert-leasen \
  --name "Leasing outbound" \
  --steps "page:/leasing/*,event:outbound"
```

Page funnel steps support a trailing `*` prefix match. Event names are normalized to lowercase.

## Dashboard exploration

Every report uses one session-scoped filtered population. Filters are encoded in the URL and can be combined:

- source and source detail
- landing page
- exit page
- any key event, no key event, or a specific configured key event

The traffic graph aligns the selected range with the immediately preceding calendar period. Today is compared with the same elapsed UTC hours yesterday. A one-day custom range is hourly; longer ranges are daily. KPI cards show the same previous-period delta.

The dashboard also exposes device and country session breakdowns, data freshness and copyable filtered views. `/sites/:siteId/journeys` contains every matching session, paginated 50 at a time.

## Remote MCP with OAuth

After deployment and migration, open `/mcp` in the dashboard for the connection checklist.

Use this remote MCP URL:

```text
https://analytics.example.com/api/mcp
```

The server publishes:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/api/mcp
/.well-known/oauth-authorization-server
```

The OAuth flow supports dynamic client registration, authorization code + S256 PKCE, refresh-token rotation and revocation. Access and refresh tokens are opaque; only SHA-256 token hashes are stored. Tokens are scoped to `analytics:read` and bound to the exact MCP resource URL.

When a client connects:

1. It discovers the protected resource and authorization server.
2. It registers a public PKCE client.
3. Your browser opens `/api/oauth/authorize` and requests the dashboard Basic-auth password.
4. You approve read-only access.
5. The client exchanges the one-time code for an access and refresh token.

Available MCP tools:

```text
minilytics_list_sites
minilytics_overview
minilytics_traffic
minilytics_acquisition
minilytics_content
minilytics_journeys
```

The MCP cannot create, edit or delete sites, events, goals, funnels or credentials.

## Source attribution

The collector preserves first-touch session attribution. The database normalization layer maps known answer engines and search engines into useful channels:

- ChatGPT, Perplexity, Copilot, Claude, Gemini, Grok, You.com, Phind and Mistral -> `organic / ai`
- Google, Bing, DuckDuckGo, Ecosia, Yahoo, Yandex, Baidu, Startpage, Swisscows, WEB.DE, Brave, Qwant, Kagi and Mojeek -> `organic / search`
- known social domains -> `social / social`
- same-site internal landings -> `direct / direct`
- remaining external domains -> `referral / referral`
- explicit unknown UTMs -> campaign

Run `npm run db:migrate` after pulling migration changes so historical rows and future inserts use the same taxonomy.

## Privacy shape

Minilytics intentionally does not collect or store:

- raw IP addresses
- form values
- DOM snapshots
- mouse movement
- full query strings
- canvas, audio or font fingerprints
- advertising audiences or cross-device identity

A rotating visitor hash is pseudonymous data rather than a legal exemption. Deployments still need an appropriate legal basis and privacy information for their jurisdiction.

## Database

The analytics model remains `sites` plus append-only `events`. OAuth credentials use separate client/code/token tables; raw authorization codes and tokens are never stored. Postgres remains sufficient at this stage—there is no Redis, queue, Kafka or ClickHouse dependency.

## Cookieless OVH edge integrations

Srocket and Preiswert Leasen can route their existing same-origin `/api/minilytics/`
endpoint to `/api/edge-collect/:siteId` on the dashboard's loopback listener. Nginx
must replace `X-Minilytics-Client-IP` with the trusted client address and authenticate
with `X-Minilytics-Edge-Secret` / `MINILYTICS_EDGE_SECRET`. Public requests without
that server credential are rejected. The browser never receives this secret.

This mode sets no cookies and reads no browser storage. An HMAC of site, network
address and User-Agent locates a random session in Postgres. Lookup hashes rotate
every 30 minutes; a previous-window match preserves an active session, and 30
minutes of inactivity expires it. Run `node scripts/prune-sessions.mjs` each minute
to remove expired keys. Raw addresses and full User-Agents never enter the analytics
database. Matching is approximate: identical browsers behind a shared address can
merge, and network/browser changes can split a visit. Session labels remain on
historical events but expired lookup keys cannot link a later visit to them.

First-touch attribution is kept in `analytics_sessions` and copied into each event.
The cleanup also removes inactive attribution lookups after a day; event history
is unchanged. Existing fragmented history is not stitched retroactively.

Realtime shows activity **received** in the last 30 minutes, independently of date
and report filters. It lists each user's latest source, medium and page, refreshes
every ten seconds while visible, and uses its own small database pool. Historical
reports share one transaction-local session rollup per period, coalesce duplicate
requests, and cache a view for ten seconds. Heavy reports cannot consume collector
or realtime connections. Cold long-range reports still depend on shared VPS load.

For an existing installation, apply only the new migrations with
`npm run db:migrate -- --only 006_sessions_realtime.sql`, then the same command for
`007_cookieless_sessions.sql`. Back up events/sites first. `npm test` runs offline
regressions. `npm run test:integration` needs a configured test database and an edge
secret; it creates temporary QA sites and deletes only those sites on completion.
