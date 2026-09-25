# OVH analytics runtime

Dashboard: `/home/ploi/analytics.magnusohle.de/current`, PM2 `minilytics-dashboard`,
loopback port 3002. Realtime requires dashboard auth. Srocket's first-party collection endpoint routes through OVH Nginx to the authenticated edge collector.
Preiswert Leasen's first-party endpoint is intercepted on UpCloud Nginx for both
`/api/minilytics` and `/api/minilytics/` and forwarded over verified TLS to the OVH
origin. Its tracker is bundled with the site; the visitor makes no analytics
connection to OVH. The private credential exists only on the two servers.
UpCloud trusts Cloudflare's published proxy ranges for the collector's client IP,
and OVH retains its existing real-IP configuration. The public endpoints strip
cookies and authorization before forwarding. Cloudflare ranges were checked
against https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6.

UpCloud route: `/etc/nginx/snippets/minilytics-edge-route.conf`, referenced from
`preiswert-leasen-app.conf`. Backup: `/root/minilytics-edge-backup-20260925`.
The upstream uses SNI `analytics.magnusohle.de`, the system CA bundle and verify
depth 3. Keep verification enabled. The remaining application traffic stays on UpCloud.

Run `scripts/prune-sessions.mjs` each minute with the shared environment. Matching
expires after 30 idle minutes even if cleanup is late. The job physically deletes
expired matching keys and day-old attribution lookups, not analytics events.
Named analytics connections use independent small pools. Competing unnamed Srocket
DB connections can run at nice 10; this changes scheduling, not query semantics.

Back up events/sites, shared environment, PM2 state and Nginx configuration. Apply
migrations 006 and 007 with `--only`. Build and test on loopback 3003 before switching
`current` and PM2 to port 3002. Validate Nginx before reloading. Do not commit the
edge credential; it belongs in the shared environment and a root-readable snippet.

Rollback collection by restoring the two Nginx site configurations, running
`nginx -t` and reloading Nginx. The original application collectors remain intact.
Rollback the dashboard by restoring its previous release in `current` and PM2.
The additive tables/indexes can remain with the old app. No historical sessions
are merged by this change. Cold large reports remain sensitive to VPS contention.

Validation on 2026-09-25: both public collection endpoints returned 204 without
Set-Cookie; two distinct browser runtime IDs became one server session and retained
google attribution. Synthetic events were removed. Public timings under shared
load: today 0.7s, first 30-day Srocket report 5.2s, cached 0.17s, Leasy 30-day 2.3s,
realtime 0.16s. A prior cold request under heavier contention took 14s, so long-range
report latency is still dependent on the shared VPS load.
