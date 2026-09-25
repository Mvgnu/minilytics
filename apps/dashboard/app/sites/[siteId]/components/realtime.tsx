"use client";
import { useEffect, useState } from "react";
import type { RealtimeData } from "../../../../lib/realtime";
import styles from "./analytics-v2.module.css";

export function Realtime({ siteId, domain }: {siteId: string; domain: string}) {
  const [data, setData] = useState<RealtimeData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | undefined;
    async function refresh() {
      if (document.visibilityState === "hidden") { timer = setTimeout(refresh, 10_000); return; }
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 12_000);
      try {
        const response = await fetch(`/api/sites/${encodeURIComponent(siteId)}/realtime`, {signal: request.signal, cache: "no-store"});
        if (!response.ok) throw new Error("Unavailable");
        const value = await response.json() as RealtimeData;
        if (!stopped) { setData(value); setError(false); }
      } catch { if (!stopped) setError(true); }
      finally { clearTimeout(timeout); if (!stopped) timer = setTimeout(refresh, 10_000); }
    }
    setData(null);
    void refresh();
    return () => { stopped = true; clearTimeout(timer); request?.abort(); };
  }, [siteId]);
  const max = Math.max(1, ...(data?.minutes.map(m => m.users) ?? []));
  const now = data ? new Date(data.updatedAt).getTime() : Date.now();
  const minutes = new Map(data?.minutes.map(m => [Math.floor(new Date(m.minute).getTime() / 60000), m.users]));
  return <section className={`panel ${styles.realtimePanel}`} aria-label="Realtime analytics">
    <div className="panelHeader"><div><p className="eyebrow">Realtime · all traffic</p><h2>Users in the last 30 minutes</h2></div>
      <span className="muted" role="status">{error ? "Refresh failed · retrying" : data ? "Updates every 10 seconds" : "Loading live activity…"}</span></div>
    {data ? <>
      <div className={styles.realtimeSummary}><strong>{data.users.toLocaleString("en")}</strong><span>active users · {data.pageviews.toLocaleString("en")} pageviews</span>
        <div className={styles.minuteBars} aria-label="Active users by minute">{Array.from({length: 30}, (_, i) => {
          const minute = Math.floor(now / 60000) - 29 + i;
          const users = minutes.get(minute) ?? 0;
          return <i key={minute} title={`${new Date(minute * 60000).toISOString().slice(11,16)} UTC: ${users} users`} style={{height: `${Math.max(2, 100 * users / max)}%`}} />;
        })}</div></div>
      <p className={`muted ${styles.realtimeNote}`}>Recent activity across this project, independent of report filters. Each user appears at their latest page. Anonymous traffic is counted by session.</p>
      <div className={styles.realtimeTable}><table><thead><tr><th>Source</th><th>Medium</th><th>Page URL</th><th>Users</th></tr></thead><tbody>
        {data.rows.map(row => <tr key={JSON.stringify([row.source,row.medium,row.path])}><td>{row.source === 'direct' ? '(direct)' : row.source}</td><td>{row.medium}</td><td className={styles.realtimeUrl} title={`${domain}${row.path}`}>{domain}{row.path}</td><td>{row.users}</td></tr>)}
      </tbody></table></div>
      {!data.users && <div className="empty">No activity received in the last 30 minutes.</div>}
    </> : error ? <div className="empty">Realtime is temporarily unavailable. Retrying automatically.</div> : null}
  </section>;
}
