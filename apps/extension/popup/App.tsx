import { useEffect, useRef, useState } from "react";
import type { AdvertiserSummary } from "../src/analytics.ts";
import type { ImportMode } from "../src/backup.ts";
import type { AdImpressionRecord } from "../src/types.ts";
import { downloadBackup, formatDuration, sendMessage } from "./dashboard-api.ts";
import type { DashboardResponse, ExportResponse, ImportResponse } from "./dashboard-api.ts";

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

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

function BackupControls({ onImported }: { onImported: () => void }) {
  const [status, setStatus] = useState("Export a JSON copy, or restore one.");
  const [mode, setMode] = useState<ImportMode>("merge");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function exportData() {
    setBusy(true);
    setStatus("Preparing export…");
    try {
      const response = await sendMessage<ExportResponse>({ type: "export-data" });
      if (!response.ok || !response.backup) throw new Error(response.error ?? "unknown error");
      downloadBackup(response.backup);
      setStatus(`Exported ${response.backup.impressions.length} impressions.`);
    } catch (error) {
      setStatus(`Export failed: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function importData(file: File) {
    setBusy(true);
    setStatus(`Importing ${file.name} (${mode})…`);
    try {
      const text = await file.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch { throw new Error("File is not valid JSON."); }
      const response = await sendMessage<ImportResponse>({ type: "import-data", mode, data });
      if (!response.ok) throw new Error(response.error ?? "unknown error");
      setStatus(`Imported ${response.imported ?? 0}, skipped ${response.skipped ?? 0} duplicates. Total: ${response.totalImpressions ?? 0}.`);
      onImported();
    } catch (error) {
      setStatus(`Import failed: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return <section aria-labelledby="backup-heading">
    <div className="section-head"><h2 id="backup-heading">Backup &amp; Restore</h2></div>
    <p id="backup-status" className="status" role="status">{status}</p>
    <div className="backup-row">
      <button id="export" type="button" disabled={busy} onClick={exportData}>Export JSON</button>
      <button id="import-trigger" type="button" disabled={busy} onClick={() => input.current?.click()}>Import JSON</button>
      <input id="import-file" ref={input} type="file" accept=".json,application/json" hidden disabled={busy} onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void importData(file);
      }} />
      <div className="segmented" role="radiogroup" aria-label="Import mode">
        {(["merge", "replace"] as const).map(value => <label key={value}>
          <input type="radio" name="import-mode" value={value} checked={mode === value} disabled={busy} onChange={() => setMode(value)} />
          <span>{value === "merge" ? "Merge" : "Replace"}</span>
        </label>)}
      </div>
    </div>
    <p className="hint">Merge skips duplicates. Replace clears local history first.</p>
  </section>;
}

export function App() {
  const [dashboard, setDashboard] = useState<DashboardResponse>();
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    sendMessage<DashboardResponse>({ type: "get-dashboard" }).then(response => {
      if (!active) return;
      if (!response?.ok) setFailed(true);
      else setDashboard(response);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [revision]);

  const data = dashboard?.ok ? dashboard : undefined;
  const analytics = data?.analytics;
  const status = failed ? "Could not open the local ad database." : !analytics ? "Loading local history…"
    : analytics.totalImpressions ? `Average ad: ${formatDuration(analytics.averageAdMs)} · Stored only on this browser`
    : "Stored only on this browser";
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
    <BackupControls onImported={() => setRevision(value => value + 1)} />
    <footer className="footnote">Stored only on this browser</footer>
  </main>;
}
