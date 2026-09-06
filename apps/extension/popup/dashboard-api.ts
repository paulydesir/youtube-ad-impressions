import type { ImpressionAnalytics } from "../src/analytics.ts";
import type { BackupFile } from "../src/backup.ts";
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

export function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function backupFileName(): string {
  return `youtube-ad-impressions-${new Date().toISOString().slice(0, 10)}.json`;
}

export function downloadBackup(backup: BackupFile): void {
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = backupFileName();
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}


export function sendMessage<T>(message: GetDashboardMessage | ExportDataMessage | ImportDataMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T | undefined) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message ?? "Could not contact the extension."));
      else if (!response) reject(new Error("No response from the extension."));
      else resolve(response);
    });
  });
}

export type { DashboardResponse, ExportResponse, ImportResponse };
