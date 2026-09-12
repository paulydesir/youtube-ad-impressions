import type { AdImpressionRecord } from "./types.ts";

export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_DATABASE_NAME = "AdTrackerDB";
export const WATCH_TIME_KEY = "watch_time_ms";

export type StoredImpression = AdImpressionRecord & { id?: number };

export interface BackupStatRow {
  key: string;
  value: number;
}

export interface BackupFile {
  formatVersion: number;
  exportedAt: string;
  database: string;
  impressions: StoredImpression[];
  stats: BackupStatRow[];
}

export type ImportMode = "merge" | "replace";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isNumberOrNull(value: unknown): value is number | null {
  return typeof value === "number" || value === null;
}

function isBooleanOrNull(value: unknown): value is boolean | null {
  return typeof value === "boolean" || value === null;
}

export function isStoredImpression(value: unknown): value is StoredImpression {
  if (!isRecord(value)) return false;
  return (
    isStringOrNull(value["advertiser_name"]) &&
    isStringOrNull(value["advertiser_url"]) &&
    isStringOrNull(value["host_video_id"]) &&
    typeof value["timestamp"] === "string" &&
    typeof value["ended_at"] === "string" &&
    isNumberOrNull(value["duration_ms"]) &&
    isStringOrNull(value["pod_position"]) &&
    isNumberOrNull(value["pod_index"]) &&
    isNumberOrNull(value["pod_size"]) &&
    typeof value["impression_index"] === "number" &&
    typeof value["skipped"] === "boolean" &&
    isStringOrNull(value["skip_clicked_at"]) &&
    typeof value["skip_available"] === "boolean" &&
    isStringOrNull(value["ad_headline"]) &&
    isStringOrNull(value["call_to_action"]) &&
    isStringOrNull(value["creative_title"]) &&
    isNumberOrNull(value["creative_duration_ms"]) &&
    isBooleanOrNull(value["muted"]) &&
    isNumberOrNull(value["playback_rate"]) &&
    isStringOrNull(value["avatar_url"]) &&
    isStringOrNull(value["player_version"]) &&
    typeof value["end_reason"] === "string" &&
    (value["event_id"] === undefined || typeof value["event_id"] === "string") &&
    (value["pod_id"] === undefined || typeof value["pod_id"] === "string") &&
    (value["id"] === undefined || typeof value["id"] === "number")
  );
}

export type ParseBackupResult =
  | { ok: true; file: BackupFile }
  | { ok: false; error: string };

export function parseBackupFile(data: unknown): ParseBackupResult {
  if (!isRecord(data)) return { ok: false, error: "Backup file must be a JSON object." };
  if (data["formatVersion"] !== BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      error: `Unsupported backup formatVersion (expected ${BACKUP_FORMAT_VERSION}).`,
    };
  }
  if (!Array.isArray(data["impressions"])) {
    return { ok: false, error: 'Backup file is missing an "impressions" array.' };
  }
  const stats = data["stats"];
  if (stats !== undefined && !Array.isArray(stats)) {
    return { ok: false, error: 'Backup "stats" must be an array when present.' };
  }

  const impressions: StoredImpression[] = [];
  for (let index = 0; index < data["impressions"].length; index += 1) {
    const candidate = data["impressions"][index];
    if (!isStoredImpression(candidate)) {
      return { ok: false, error: `Impression at index ${index} is invalid.` };
    }
    impressions.push(candidate);
  }

  const statRows: BackupStatRow[] = [];
  for (const entry of stats ?? []) {
    if (
      isRecord(entry) &&
      typeof entry["key"] === "string" &&
      typeof entry["value"] === "number"
    ) {
      statRows.push({ key: entry["key"], value: entry["value"] });
    }
  }

  const exportedAt =
    typeof data["exportedAt"] === "string" ? data["exportedAt"] : new Date(0).toISOString();
  const database =
    typeof data["database"] === "string" ? data["database"] : BACKUP_DATABASE_NAME;
  return { ok: true, file: { formatVersion: 1, exportedAt, database, impressions, stats: statRows } };
}

export function buildBackupFile(
  impressions: StoredImpression[],
  watchTimeMs: number,
): BackupFile {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    database: BACKUP_DATABASE_NAME,
    // The old browser database's auto-increment key is a local implementation detail. Portable
    // identity comes exclusively from event_id.
    impressions: impressions.map(({ id: _localId, ...record }) => record),
    stats: [{ key: WATCH_TIME_KEY, value: watchTimeMs }],
  };
}

export function backupWatchTimeMs(file: BackupFile): number {
  return file.stats.find((stat) => stat.key === WATCH_TIME_KEY)?.value ?? 0;
}

export function dedupeKey(record: StoredImpression): string {
  if (record.event_id) return `event:${record.event_id}`;
  return [
    record.timestamp,
    record.advertiser_url ?? "",
    record.host_video_id ?? "",
    record.duration_ms ?? "",
    record.impression_index,
  ].join("|");
}
