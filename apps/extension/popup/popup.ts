// Popup dashboard: reads the worker's aggregated analytics and renders them.
// Runs as a bundled IIFE in `dist/popup/popup.html` (see scripts/build.mjs).
import type { AdvertiserSummary, ImpressionAnalytics } from "../src/analytics.ts";
import type { BackupFile, ImportMode } from "../src/backup.ts";
import type {
  AdImpressionRecord,
  ExportDataMessage,
  GetDashboardMessage,
  ImportDataMessage,
} from "../src/types.ts";

interface DashboardSuccess {
  ok: true;
  records: AdImpressionRecord[];
  analytics: ImpressionAnalytics;
}

interface DashboardFailure {
  ok: false;
  error?: string;
}

type DashboardResponse = DashboardSuccess | DashboardFailure | undefined;

interface ExportResponse {
  ok: boolean;
  backup?: BackupFile;
  error?: string;
}

interface ImportResponse {
  ok: boolean;
  imported?: number;
  skipped?: number;
  totalImpressions?: number;
  watchTimeMs?: number;
  error?: string;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing popup element: ${selector}`);
  return element;
}

function appendTextElement<K extends keyof HTMLElementTagNameMap>(
  parent: ParentNode,
  tag: K,
  className: string,
  value: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  parent.append(element);
  return element;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function appendChip(parent: ParentNode, name: string): void {
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.setAttribute("aria-hidden", "true");
  chip.textContent = (name.trim()[0] ?? "?").toUpperCase();
  parent.append(chip);
}

function renderAdvertisers(advertisers: AdvertiserSummary[]): void {
  const list = requireElement<HTMLOListElement>("#advertisers");
  list.replaceChildren();
  if (!advertisers.length) {
    appendTextElement(list, "li", "empty", "No ads captured yet.");
    return;
  }

  for (const advertiser of advertisers.slice(0, 8)) {
    const item = document.createElement("li");
    appendChip(item, advertiser.name);
    const ad = document.createElement("div");
    ad.className = "ad";
    appendTextElement(ad, "span", "name", advertiser.name);
    item.append(ad);
    appendTextElement(
      item,
      "span",
      "count",
      `${advertiser.impressions} · ${formatDuration(advertiser.durationMs)}`,
    );
    list.append(item);
  }
}

function renderRecent(records: AdImpressionRecord[]): void {
  const container = requireElement<HTMLDivElement>("#recent");
  container.replaceChildren();
  if (!records.length) {
    appendTextElement(
      container,
      "p",
      "empty",
      "Watch YouTube normally; completed ads appear here.",
    );
    return;
  }

  for (const record of records.slice(0, 10)) {
    const item = document.createElement("article");
    item.className = "recent-item";
    const name =
      record.advertiser_name ?? record.advertiser_url ?? "Unknown advertiser";
    appendChip(item, name);
    appendTextElement(item, "span", "name", name);
    const metaRow = document.createElement("div");
    metaRow.className = "meta-row";
    appendTextElement(
      metaRow,
      "span",
      "meta",
      `${formatDuration(record.duration_ms ?? 0)}${record.pod_position ? ` · ${record.pod_position}` : ""}`,
    );
    if (record.skipped) appendTextElement(metaRow, "span", "badge", "Skipped");
    const time = appendTextElement(
      metaRow,
      "time",
      "",
      dateFormatter.format(new Date(record.timestamp)),
    );
    time.dateTime = record.timestamp;
    item.append(metaRow);
    container.append(item);
  }
}

function loadDashboard(): void {
  const message: GetDashboardMessage = { type: "get-dashboard" };
  chrome.runtime.sendMessage(message, (response: DashboardResponse) => {
    const status = requireElement<HTMLElement>("#status");
    if (chrome.runtime.lastError || !response?.ok) {
      status.textContent = "Could not open the local ad database.";
      return;
    }

    const { analytics, records } = response;
    requireElement<HTMLElement>("#total-impressions").textContent = String(
      analytics.totalImpressions,
    );
    requireElement<HTMLElement>("#total-time").textContent = formatDuration(
      analytics.totalAdMs,
    );
    requireElement<HTMLElement>("#ads-per-hour").textContent =
      analytics.adsPerWatchHour === null ? "—" : analytics.adsPerWatchHour.toFixed(1);
    requireElement<HTMLElement>("#skip-rate").textContent =
      `${Math.round(analytics.skipRate * 100)}%`;
    status.textContent = analytics.totalImpressions
      ? `Average ad: ${formatDuration(analytics.averageAdMs)} · Stored only on this browser`
      : "Stored only on this browser";

    renderAdvertisers(analytics.advertisers);
    renderRecent(records);
  });
}

function backupFileName(): string {
  return `youtube-ad-impressions-${new Date().toISOString().slice(0, 10)}.json`;
}

function downloadBackup(backup: BackupFile): void {
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = backupFileName();
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wireBackupControls(): void {
  const backupStatus = requireElement<HTMLElement>("#backup-status");
  const exportButton = requireElement<HTMLButtonElement>("#export");
  const importTrigger = requireElement<HTMLButtonElement>("#import-trigger");
  const importInput = requireElement<HTMLInputElement>("#import-file");

  exportButton.addEventListener("click", () => {
    backupStatus.textContent = "Preparing export…";
    const message: ExportDataMessage = { type: "export-data" };
    chrome.runtime.sendMessage(message, (response: ExportResponse | undefined) => {
      if (chrome.runtime.lastError || !response?.ok || !response.backup) {
        backupStatus.textContent =
          `Export failed: ${response?.error ?? chrome.runtime.lastError?.message ?? "unknown error"}`;
        return;
      }
      downloadBackup(response.backup);
      backupStatus.textContent =
        `Exported ${response.backup.impressions.length} impressions.`;
    });
  });

  importTrigger.addEventListener("click", () => importInput.click());

  importInput.addEventListener("change", () => {
    const file = importInput.files?.[0];
    importInput.value = "";
    if (!file) return;
    const checkedMode = document.querySelector<HTMLInputElement>(
      'input[name="import-mode"]:checked',
    );
    const mode: ImportMode = checkedMode?.value === "replace" ? "replace" : "merge";
    backupStatus.textContent = `Importing ${file.name} (${mode})…`;
    file
      .text()
      .then((text) => {
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error("File is not valid JSON.");
        }
        const message: ImportDataMessage = { type: "import-data", mode, data };
        chrome.runtime.sendMessage(message, (response: ImportResponse | undefined) => {
          if (chrome.runtime.lastError || !response?.ok) {
            backupStatus.textContent =
              `Import failed: ${response?.error ?? chrome.runtime.lastError?.message ?? "unknown error"}`;
            return;
          }
          backupStatus.textContent =
            `Imported ${response.imported ?? 0}, skipped ${response.skipped ?? 0} duplicates. Total: ${response.totalImpressions ?? 0}.`;
          loadDashboard();
        });
      })
      .catch((error: unknown) => {
        backupStatus.textContent =
          `Import failed: ${error instanceof Error ? error.message : String(error)}`;
      });
  });
}

loadDashboard();
wireBackupControls();
