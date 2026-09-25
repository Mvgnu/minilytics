"use client";
export default function DashboardError({ reset }: { reset: () => void }) {
  return <section className="panel" role="alert"><h2>This report could not load</h2><p>Your selected view is saved in the URL. Retry the report.</p><button onClick={reset}>Retry report</button></section>;
}
