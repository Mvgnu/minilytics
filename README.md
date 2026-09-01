# Minilytics

Tiny first-party analytics for sites you own.

The browser only talks to the site it is visiting:

```text
visitor
  -> https://your-site.example/api/minilytics
  -> server-side proxy
  -> https://analytics.example.com/api/collect
  -> Postgres
  -> Minilytics dashboard
```

No external analytics script, pixel or cookie domain is loaded in the browser. The central collector is contacted server-to-server.

## MVP

- pageviews
- first-touch acquisition: direct, organic search, social, referral and UTM campaigns
- automatic click + outbound click events
- custom business events
- visitor/session/pageview graphs
- top URLs
- source breakdown
- recent session journeys
- multiple projects in one dashboard
- no IP address storage
- first-party `sessionStorage` visitor identity by default
- optional persistent first-party visitor ID using `localStorage`

> First-party storage is not automatically exempt from privacy/consent requirements. The default keeps identity to the browser session; choose the persistent mode only when it fits your consent setup.

## 1. Run the dashboard

Requirements: Node 20.9+ and Postgres.

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run dev
```

Set `DASHBOARD_PASSWORD` in production. Minilytics uses HTTP Basic auth for the dashboard and deliberately leaves `/api/collect` reachable for authenticated site proxies.

## 2. Register a site

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

The secret is stored in Postgres only as SHA-256 and is only printed once.

## 3. Add it to a Next.js site

The tracker lives in `packages/tracker` and is ready to publish as `@mvgnu/minilytics`.

In the tracked site, set server-side environment variables:

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

Then put one component in the root layout:

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

That is the entire browser integration.

`<Analytics />` automatically records the initial pageview, SPA navigation, clicks and outbound clicks. It strips query strings from stored page paths and clicked URLs. UTM attribution is extracted separately.

### Mark important clicks

Automatic clicks are useful, but explicit labels make the dashboard much better:

```tsx
<a href={offer.url} data-minilytics="leasing-offer">
  Zum Angebot
</a>
```

### Custom events

The component exposes a tiny global API:

```ts
window.minilytics?.track("lead", {
  provider: "leasingmarkt",
  commission: 10,
});
```

Custom event properties are capped at 4 KB.

### Persistent visitors

The default is session-scoped:

```tsx
<Analytics visitorMode="session" />
```

Other modes:

```tsx
<Analytics visitorMode="persistent" /> // localStorage
<Analytics visitorMode="none" />       // no visitor id
```

The session ID is still required to construct journeys.

## Source attribution

Attribution is captured on the landing page and kept for the session.

Rules in the MVP:

- UTM present -> campaign
- empty referrer -> direct
- Google/Bing/DuckDuckGo/Ecosia/Yahoo/Yandex -> organic
- Instagram/TikTok/Facebook/Reddit/X/LinkedIn/YouTube -> social
- everything else -> referral

Internal navigation never overwrites the session's original landing attribution.

## Privacy shape

Minilytics intentionally does not collect:

- IP addresses
- form values
- DOM snapshots
- mouse movement
- full query strings
- fingerprinting signals

The tracked site forwards only the browser user agent and an optional coarse country code already supplied by Vercel/Cloudflare. User agent is reduced to `desktop`, `tablet` or `mobile` before storage.

## Database

The first migration is `db/001_init.sql`. The core model is intentionally just `sites` + append-only `events`, with indexes for site/time, pages, sessions and sources.

Postgres is enough for this stage. There is no Redis, queue, ClickHouse or separate ingestion service yet.

## Next

Good follow-ups after the MVP has real traffic:

1. configurable bot filtering
2. conversion funnels
3. revenue/event-property aggregation
4. date range controls
5. CSV export
6. a standalone first-party script for WordPress/non-React sites
7. retention + rollups if raw events ever become meaningfully large
