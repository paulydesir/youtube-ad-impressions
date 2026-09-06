import { useEffect, useRef, useState } from "react";
import type { AdvertiserSummary } from "../src/analytics.ts";
import type { AdImpressionRecord } from "../src/types.ts";
import { formatDuration, saveIngestToken, sendMessage } from "./dashboard-api.ts";
import type { DashboardResponse } from "./dashboard-api.ts";

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function ServerConnection({ failed, loading, onRetry }: {
  failed: boolean;
  loading: boolean;
  onRetry: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = loading || saving;

  return <details className="server-connection" open={failed}>
    <summary>Server connection</summary>
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      setSaving(true);
      setError(null);
      try {
        await saveIngestToken(input.current?.value ?? "");
        if (input.current) input.current.value = "";
        onRetry();
      } catch (error) {
        setError(errorMessage(error));
      } finally {
        setSaving(false);
      }
    }}>
      <label htmlFor="server-token">Server API token</label>
      <p id="server-token-hint" className="hint">Paste INGEST_API_TOKEN from apps/server/.env. This connects the extension to your local server.</p>
      <input id="server-token" ref={input} type="password" required autoComplete="off" spellCheck={false}
        aria-describedby="server-token-hint" disabled={busy} placeholder="Enter server API token" />
      <div className="connection-actions">
        <button type="submit" disabled={busy}>{saving ? "Saving…" : "Save & connect"}</button>
        <button type="button" disabled={busy} onClick={onRetry}>{loading ? "Connecting…" : "Retry connection"}</button>
      </div>
      {error && <p className="status" role="alert">{error}</p>}
    </form>
  </details>;
}

function Chip({ name }: { name: string }) {
  return <span className="chip" aria-hidden="true">{(name.trim()[0] ?? "?").toUpperCase()}</span>;
}

function Advertisers({ advertisers }: { advertisers: AdvertiserSummary[] }) {
  return <ol id="advertisers" className="ranking">
    {advertisers.length ? advertisers.slice(0, 8).map(advertiser =>
      <li key={advertiser.name}>
        <Chip name={advertiser.name} />
        <div className="ad"><span className="name">{advertiser.name}</span></div>
        <span className="count">{advertiser.impressions} · {formatDuration(advertiser.durationMs)}</span>
      </li>) : <li className="empty">No ads captured yet.</li>}
  </ol>;
}

function RecentImpressions({ records }: { records: AdImpressionRecord[] }) {
  return <div id="recent" className="recent">
    {records.length ? records.slice(0, 10).map((record, index) => {
      const name = record.advertiser_name ?? record.advertiser_url ?? "Unknown advertiser";
      return <article className="recent-item" key={record.event_id ?? `${record.timestamp}-${index}`}>
        <Chip name={name} /><span className="name">{name}</span>
        <div className="meta-row">
          <span className="meta">{formatDuration(record.duration_ms ?? 0)}{record.pod_position ? ` · ${record.pod_position}` : ""}</span>
          {record.skipped && <span className="badge">Skipped</span>}
          <time dateTime={record.timestamp}>{dateFormatter.format(new Date(record.timestamp))}</time>
        </div>
      </article>;
    }) : <p className="empty">Watch YouTube normally; completed ads appear here.</p>}
  </div>;
}

export function App() {
  const [dashboard, setDashboard] = useState<DashboardResponse>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setDashboard(undefined);
    sendMessage<DashboardResponse>({ type: "get-dashboard" }).then(response => {
      if (!active) return;
      if (!response?.ok) setError(response?.error ?? "The server did not return a dashboard.");
      else {
        setError(null);
        setDashboard(response);
      }
    }).catch(error => { if (active) setError(errorMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  const data = dashboard?.ok ? dashboard : undefined;
  const analytics = data?.analytics;
  const status = loading ? "Loading server history…" : error ?? (!analytics ? "No dashboard available."
    : analytics.totalImpressions ? `Average ad: ${formatDuration(analytics.averageAdMs)} · Stored in PostgreSQL`
    : "Stored in PostgreSQL");
  const metrics = [
    ["total-impressions", "Impressions", analytics ? String(analytics.totalImpressions) : "—"],
    ["total-time", "Ad time", analytics ? formatDuration(analytics.totalAdMs) : "—"],
    ["ads-per-hour", "Ads / watch hr", analytics?.adsPerWatchHour?.toFixed(1) ?? "—"],
    ["skip-rate", "Skipped", analytics ? `${Math.round(analytics.skipRate * 100)}%` : "—"],
  ];
  return <main>
    <header className="hero">
      <p className="eyebrow"><span className="dot" aria-hidden="true" />Local ad journal</p>
      <h1>YouTube Ad Impressions</h1>
      <p id="status" className="status" role="status">{status}</p>
    </header>
    <ServerConnection failed={Boolean(error)} loading={loading} onRetry={() => setRevision(value => value + 1)} />
    <section className="metrics" aria-label="Summary">
      {metrics.map(([id, label, value]) => <article className="metric" key={id}>
        <span className="metric-label">{label}</span><strong className="metric-value" id={id}>{value}</strong>
      </article>)}
    </section>
    <section aria-labelledby="advertisers-heading">
      <div className="section-head"><h2 id="advertisers-heading">Top Advertisers</h2></div>
      {data && <Advertisers advertisers={data.analytics.advertisers} />}
    </section>
    <section aria-labelledby="recent-heading">
      <div className="section-head"><h2 id="recent-heading">Recent Impressions</h2></div>
      {data && <RecentImpressions records={data.records} />}
    </section>
    <footer className="footnote">Stored in PostgreSQL</footer>
  </main>;
}
