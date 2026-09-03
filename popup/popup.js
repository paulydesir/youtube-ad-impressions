function formatDuration(milliseconds) {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function appendTextElement(parent, tag, className, value) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  parent.append(element);
  return element;
}

function renderAdvertisers(advertisers) {
  const list = document.querySelector("#advertisers");
  if (!advertisers.length) {
    appendTextElement(list, "li", "empty", "No ads captured yet.");
    return;
  }

  for (const advertiser of advertisers.slice(0, 8)) {
    const item = document.createElement("li");
    appendTextElement(item, "span", "name", advertiser.name);
    appendTextElement(
      item,
      "span",
      "count",
      `${advertiser.impressions} · ${formatDuration(advertiser.durationMs)}`,
    );
    list.append(item);
  }
}

function renderRecent(records) {
  const container = document.querySelector("#recent");
  if (!records.length) {
    appendTextElement(container, "p", "empty", "Watch YouTube normally; completed ads appear here.");
    return;
  }

  for (const record of records.slice(0, 10)) {
    const startedAt = record.started_at || record.timestamp;
    const item = document.createElement("article");
    item.className = "recent-item";
    appendTextElement(
      item,
      "span",
      "name",
      record.advertiser_name ||
        record.advertiser_domain ||
        record.advertiser_url ||
        "Unknown advertiser",
    );
    appendTextElement(
      item,
      "span",
      "meta",
      `${formatDuration(record.duration_ms || 0)}` +
        `${record.skipped ? " · skipped" : ""}` +
        `${record.pod_label || record.pod_position ? ` · ${record.pod_label || record.pod_position}` : ""}`,
    );
    const time = appendTextElement(
      item,
      "time",
      "",
      new Date(startedAt).toLocaleString(),
    );
    time.dateTime = startedAt;
    container.append(item);
  }
}

chrome.runtime.sendMessage({ type: "get-dashboard" }, (response) => {
  const status = document.querySelector("#status");
  if (chrome.runtime.lastError || !response?.ok) {
    status.textContent = "Could not open the local ad database.";
    return;
  }

  const { analytics, records } = response;
  document.querySelector("#total-impressions").textContent = analytics.totalImpressions;
  document.querySelector("#total-time").textContent = formatDuration(analytics.totalAdMs);
  document.querySelector("#ads-per-hour").textContent =
    analytics.adsPerWatchHour === null ? "—" : analytics.adsPerWatchHour.toFixed(1);
  document.querySelector("#skip-rate").textContent = `${Math.round(analytics.skipRate * 100)}%`;
  status.textContent = analytics.totalImpressions
    ? `Average ad: ${formatDuration(analytics.averageAdMs)} · Stored only on this browser`
    : "Stored only on this browser";

  renderAdvertisers(analytics.advertisers);
  renderRecent(records);
});
