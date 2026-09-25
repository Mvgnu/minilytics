# OVH analytics runtime

Dashboard: `/home/ploi/analytics.magnusohle.de/current`, PM2 `minilytics-dashboard`,
loopback port 3002. Realtime requires dashboard auth. The two first-party site
collection endpoints route through Nginx to the authenticated edge collector.
Preiswert Leasen's remaining application traffic stays on UpCloud.

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
