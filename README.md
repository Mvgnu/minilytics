# Minilytics

Tiny first-party analytics for sites you own.

```text
visitor
  -> https://your-site.example/api/minilytics
  -> same-origin server proxy
  -> https://analytics.example.com/api/collect
  -> Postgres
  -> Minilytics dashboard
```

The browser never loads an analytics script, pixel or cookie from the central analytics domain. The collector is contacted server-to-server.

## What it tracks

- pageviews and SPA navigation
- privacy-oriented unique visitor estimates + sessions
- active visible-tab engagement time
- engaged sessions, engagement rate and bounce rate
- direct, organic, social, referral and UTM attribution
- session acquisition and first-observed visitor acquisition
- landing and exit pages
- automatic clicks, outbound clicks, downloads and form submissions
- site-configurable key events / goals
- ordered funnels
- custom business events
- Core Web Vitals + FCP/TTFB at p75
- page-level visits, clicks and active engagement
- recent session journeys
- multiple projects in one dashboard

Minilytics deliberately has no revenue/value model.

## Measurement semantics

A session uses the same 30-minute inactivity timeout as the tracker already used.

An **engaged session** qualifies when any of these is true:

- at least 10 seconds of active visible-tab engagement time
- at least 2 pageviews
- at least 1 configured key event

Engagement rate is engaged sessions / sessions. Bounce rate is the inverse.

Active engagement time is measured while the document is visible. The tracker flushes small `engagement` deltas on a timer, navigation, visibility changes and page hide. These are technical events and are hidden from the normal Actions report.

## Visitor counting

By default the same-origin proxy estimates unique visitors without setting a persistent visitor cookie or localStorage identifier.

```text
HMAC(site secret, site id + rotation bucket + IP address + User-Agent)
```

The default rotation period is 24 hours. Raw IP addresses are never added to the analytics event payload or stored in Postgres. The site id and per-site secret make the resulting identifier site-scoped.

The tradeoff is intentional: a person returning after the rotation boundary can be counted again. The dashboard visitor metric is therefore a privacy-oriented estimate, not an identity graph.

A rotating hash is pseudonymous data, not a magic privacy-law exemption. Deployments still need an appropriate legal basis and privacy information for their jurisdiction.

## 1. Run the dashboard

Requirements: Node 20.9+ and Postgres.

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run dev
```

`db:migrate` applies all numbered SQL migrations in `db/` in order. The migrations are idempotent.

Set `DASHBOARD_PASSWORD` in production. The dashboard uses HTTP Basic auth and deliberately leaves `/api/collect` reachable for authenticated site proxies.

The dashboard runs on Next.js 16, so request interception is implemented as `proxy.ts` rather than the old `middleware.ts` convention.

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

The secret is stored centrally only as SHA-256 and is shown once. The tracked site's server also uses it as the HMAC key for rotating visitor ids.

## 3. Add it to a Next.js site

Set server-side environment variables:

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

`<Analytics />` automatically records pageviews, SPA navigation, active engagement, Web Vitals, clicks, outbound clicks, downloads and form submissions. Query strings are stripped from stored page and target URLs; UTM attribution is extracted separately.

### Tracker options

```tsx
<Analytics
  autoPageviews
  autoClicks
  autoForms
  autoEngagement
  autoWebVitals
  visitorMode="session"
/>
```

All automatic measurement flags default to `true`.

Web Vitals use the bundled `web-vitals` package and are sent back through the same first-party Minilytics endpoint. No CDN script is loaded. Minilytics records LCP, INP, CLS, FCP and TTFB and reports p75 plus sample counts in the dashboard.

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

The proxy normalizes forwarded IP chains to the first address, validates JSON in every visitor mode, caches its imported HMAC key, filters obvious bot user agents and enforces the request byte limit before forwarding.

Set `networkVisitors: false` only when you deliberately want the client-provided visitor identity instead. Increasing `visitorRotationHours` increases linkability and is a privacy/product decision, not just an accuracy knob.

## Key events / goals

`outbound` is the default key event because outbound destination clicks are the primary conversion for many Minilytics deployments.

Configure a site's key events with:

```bash
npm run site:goals -- \
  --id preiswert-leasen \
  --events outbound,lead
```

The dashboard shows event count, sessions with each goal, overall session key-event rate, and uses configured key events when calculating engaged sessions and funnels.

Important clicks can still be labeled explicitly:

```tsx
<a href={offer.url} data-minilytics="dealer-outbound">
  Zum Angebot
</a>
```

Forms can use the same attribute. No input values are captured.

## Funnels

Every site gets a built-in session funnel:

```text
Sessions -> Engaged sessions -> Key-event sessions
```

You can add ordered custom funnels from pageviews, events and labeled targets:

```bash
npm run site:funnel -- \
  --id preiswert-leasen \
  --name "Leasing outbound" \
  --steps "page:/leasing/*,event:outbound"
```

Supported step forms:

```text
page:/leasing/bmw
page:/leasing/*       # trailing * = prefix match
event:outbound
event:lead
label:dealer-outbound
```

A session must hit the configured steps in order to advance through the funnel. Funnel counts are session counts, not raw event counts.

## Acquisition scopes

**Session acquisition** reports the source / detail / campaign attached to the current session and includes engaged-session and key-event-session counts.

**User acquisition** reports the first source Minilytics has observed for each visitor id active in the selected period. With the default 24-hour rotating network identity this is intentionally a short-lived first-observed identity; persistent browser identity only makes sense when deliberately enabled and legally appropriate.

Attribution rules:

- UTM present -> campaign
- empty referrer -> direct
- Google/Bing/DuckDuckGo/Ecosia/Yahoo/Yandex -> organic
- Instagram/TikTok/Facebook/Reddit/X/LinkedIn/YouTube -> social
- everything else -> referral

Internal navigation never overwrites the session's landing attribution.

## Custom events

```ts
window.minilytics?.track("lead", {
  provider: "leasingmarkt",
});
```

Custom event properties are capped at 4 KB. Minilytics intentionally does not assign monetary value or revenue semantics to them.

## Client visitor modes

The client keeps a first-party `sessionStorage` session id so multi-page journeys and session attribution survive hard navigation.

```tsx
<Analytics visitorMode="session" />    // default
<Analytics visitorMode="persistent" /> // localStorage visitor id
<Analytics visitorMode="none" />       // no client visitor id
```

When the default server-side `networkVisitors` mode is enabled, the rotating HMAC visitor id replaces the client visitor id before forwarding centrally.

## Privacy shape

Minilytics intentionally does not collect or store:

- raw IP addresses
- form values
- DOM snapshots
- mouse movement
- full query strings
- canvas/audio/font fingerprints
- revenue or advertising audience data

The central collector receives the User-Agent transiently only so it can reduce it to a coarse device type; the full value is not stored.

Both the same-origin proxy and central collector enforce a 16 KiB request limit by streamed byte length. Oversized requests receive HTTP 413.

## Database

The core storage model remains intentionally small:

- `sites`: project metadata, key-event names and optional funnel definitions
- `events`: append-only measurement stream

Sessions, engagement, landing/exit pages, acquisition reports and funnels are derived from the event stream rather than copied into additional analytics tables.

Postgres is enough for this stage. There is no Redis, queue, ClickHouse or separate ingestion service.
