import type { ImpressionAnalytics } from "../src/analytics.ts";
import type {
  AdImpressionRecord,
  GetDashboardMessage,
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

export function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function sendMessage<T>(message: GetDashboardMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T | undefined) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message ?? "Could not contact the extension."));
      else if (!response) reject(new Error("No response from the extension."));
      else resolve(response);
    });
  });
}

export type { DashboardResponse };
