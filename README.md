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

## What it tracks

- pageviews and SPA navigation
- direct, organic search, social, referral and UTM attribution
- automatic clicks and outbound clicks
- automatic file downloads
- automatic form submissions without form values
- custom business events
- visitor/session/pageview graphs
- top URLs and clicks per URL
- source breakdown
- recent session journeys
- multiple projects in one dashboard

## Visitor counting

By default the same-origin proxy estimates daily unique visitors without setting a persistent visitor cookie or localStorage identifier.

For each analytics request it derives a site-scoped rotating identifier from data the web server already receives:

```text
HMAC(site secret, site id + rotation bucket + IP address + User-Agent)
```

The default rotation period is 24 hours. The raw IP address is never added to the event payload or stored in Postgres. The resulting identifier cannot be used to correlate visitors across different Minilytics sites because the site id and per-site secret are part of the HMAC input.

This intentionally trades cross-day identity for less persistent tracking. A visitor returning on another day can be counted again, so the dashboard's visitor number should be understood as a privacy-oriented unique-visitor estimate rather than a count of identifiable people over the full date range.

A rotating hash is still pseudonymous data, not a magic exemption from privacy law. Minilytics minimizes data collection, but deployments still need an appropriate legal basis and privacy information for their jurisdiction.

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

The dashboard runs on Next.js 16. Its request interception file is therefore `proxy.ts`; Next.js renamed the old `middleware.ts` convention to `proxy.ts` in v16.

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

The secret is stored in Postgres only as SHA-256 and is only printed once. The tracked site's server also uses that secret as the HMAC key for rotating network visitor ids.

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

`<Analytics />` automatically records the initial pageview, SPA navigation, clicks, outbound clicks, downloads and form submissions. It strips query strings from stored page paths and clicked URLs. UTM attribution is extracted separately.

### Proxy options

Network visitor estimation and obvious-bot filtering are enabled by default:

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

Set `networkVisitors: false` if you explicitly want the client-provided visitor id to be used instead. Increasing `visitorRotationHours` makes returning visitors linkable for longer and should be treated as a privacy/product decision, not merely an accuracy knob.

### Mark important clicks

Automatic clicks are useful, but explicit labels make the dashboard much better:

```tsx
<a href={offer.url} data-minilytics="leasing-offer">
  Zum Angebot
</a>
```

The same attribute can label forms:

```tsx
<form data-minilytics="lead-form">...</form>
```

No input values are captured.

### Custom events

The component exposes a tiny global API:

```ts
window.minilytics?.track("lead", {
  provider: "leasingmarkt",
  commission: 10,
});
```

Custom event properties are capped at 4 KB.

### Client visitor modes

The client still maintains a first-party `sessionStorage` session id so multi-page journeys and first-touch attribution survive navigation. `visitorMode` controls the additional client visitor id:

```tsx
<Analytics visitorMode="session" />    // default
<Analytics visitorMode="persistent" /> // persistent localStorage id
<Analytics visitorMode="none" />       // no client visitor id
```

When the default server-side `networkVisitors` mode is enabled, its rotating HMAC id replaces the client visitor id before the event is forwarded centrally. `persistent` is therefore mainly useful when `networkVisitors` is disabled and your consent/privacy setup deliberately supports cross-session identity.

First-party browser storage is not automatically exempt from privacy/consent requirements.

## Source attribution

Attribution is captured on the landing page and kept for the session.

Rules:

- UTM present -> campaign
- empty referrer -> direct
- Google/Bing/DuckDuckGo/Ecosia/Yahoo/Yandex -> organic
- Instagram/TikTok/Facebook/Reddit/X/LinkedIn/YouTube -> social
- everything else -> referral

Internal navigation never overwrites the session's original landing attribution.

## Privacy shape

Minilytics intentionally does not collect or store:

- raw IP addresses
- form values
- DOM snapshots
- mouse movement
- full query strings
- canvas/audio/font fingerprints

The network visitor id uses only the request IP and User-Agent already received by the same-origin server, keyed with the site's secret and rotated by default every 24 hours. The central collector still receives the User-Agent transiently so it can reduce it to a coarse device type before storage; the full value is not stored.

## Payload limits

Both the same-origin proxy and the central collector enforce a 16 KiB request limit by streamed byte length rather than JavaScript string length. Oversized requests receive HTTP 413.

## Database

The core model is intentionally `sites` + append-only `events`, with indexes for site/time, pages, sessions and sources.

Postgres is enough for this stage. There is no Redis, queue, ClickHouse or separate ingestion service yet.

## Next measurement layer

The next useful additions should be semantic rather than simply collecting more data:

1. engaged sessions, engagement rate/bounce rate and active engagement time
2. landing/exit pages and pages per session
3. key events/goals and conversion rate
4. source -> landing page -> key event funnels
5. revenue/value attribution from custom events
6. browser/OS breakdown from server request headers
7. Core Web Vitals as aggregate page metrics
8. date-range controls and period comparison
9. standalone first-party script for WordPress/non-React sites
10. retention/rollups only if raw event volume ever makes them necessary
