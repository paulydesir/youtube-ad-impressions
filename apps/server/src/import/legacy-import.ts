import { createHash } from "node:crypto";
import { adImpressionV1Schema, type AdImpressionV1 } from "@ad-impressions/contracts";
import type { ImpressionStore } from "../repositories/store.js";

export interface LegacyImportSummary {
  accepted: number;
  duplicates: number;
  rejected: number;
}

// Stable content hash over the observation itself. The IndexedDB
// auto-increment `id` is deliberately excluded: it is browser-local and
// changes across exports, while the observed content does not.
function legacyEventId(row: Record<string, unknown>): string {
  const stable = [
    row["timestamp"],
    row["ended_at"],
    row["advertiser_name"],
    row["advertiser_url"],
    row["host_video_id"],
    row["duration_ms"],
    row["ad_headline"],
    row["call_to_action"],
    row["creative_title"],
    row["creative_duration_ms"],
    row["pod_index"],
    row["pod_size"],
    row["impression_index"],
    row["skipped"],
    row["skip_clicked_at"],
    row["end_reason"],
  ];
  const digest = createHash("sha256").update(JSON.stringify(stable)).digest("hex");
  return `legacy-${digest}`;
}

function legacyPodId(eventId: string): string {
  // Legacy exports contain an ad's position within a pod, but no trustworthy
  // shared pod boundary. A unique event-derived ID avoids false grouping.
  return `legacy-pod:${eventId}`;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function asBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

// Maps one legacy IndexedDB row onto the V1 contract. The legacy
// `pod_position` string ("1 of 2") is a display label, so it becomes
// `pod_label`; the numeric `pod_index` becomes `pod_position`.
function normalizeLegacyRow(row: Record<string, unknown>): AdImpressionV1 {
  // New extension exports own their UUID identities. Deterministic legacy
  // identities remain only as a compatibility fallback for older exports.
  const eventId = nonEmptyString(row["event_id"]) ?? legacyEventId(row);
  const podId = nonEmptyString(row["pod_id"]) ?? legacyPodId(eventId);
  const skipped = row["skipped"];
  if (typeof skipped !== "boolean") {
    throw new Error("Legacy row is missing required boolean skipped.");
  }
  const candidate = {
    schema_version: 1,
    event_id: eventId,
    source: "youtube",
    started_at: row["timestamp"],
    ended_at: asStringOrNull(row["ended_at"]),
    duration_ms: asNumberOrNull(row["duration_ms"]),
    host_video_id: asStringOrNull(row["host_video_id"]),
    advertiser_name: asStringOrNull(row["advertiser_name"]),
    advertiser_domain: asStringOrNull(row["advertiser_url"]),
    ad_headline: asStringOrNull(row["ad_headline"]),
    call_to_action: asStringOrNull(row["call_to_action"]),
    creative_title: asStringOrNull(row["creative_title"]),
    creative_duration_ms: asNumberOrNull(row["creative_duration_ms"]),
    pod_id: podId,
    pod_label: asStringOrNull(row["pod_position"]),
    pod_position: asNumberOrNull(row["pod_index"]),
    pod_size: asNumberOrNull(row["pod_size"]),
    pod_impression_index: row["impression_index"],
    skipped,
    skip_clicked_at: asStringOrNull(row["skip_clicked_at"]),
    end_reason: asStringOrNull(row["end_reason"]),
    advertiser_url: asStringOrNull(row["advertiser_url"]),
    skip_available: asBooleanOrNull(row["skip_available"]),
    muted: asBooleanOrNull(row["muted"]),
    playback_rate: asNumberOrNull(row["playback_rate"]),
    avatar_url: asStringOrNull(row["avatar_url"]),
    player_version: asStringOrNull(row["player_version"]),
  };
  return adImpressionV1Schema.parse(candidate);
}

// Imports a parsed JSON export envelope. Understands the current envelope
// ({ impressions, stats }); the cumulative `stats` record is ignored for the
// MVP. Safe to run repeatedly: deterministic legacy event IDs make re-imports
// report duplicates instead of inserting new rows.
export async function importLegacyExport(
  store: ImpressionStore,
  userId: string,
  data: unknown,
): Promise<LegacyImportSummary> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Export file must be a JSON object.");
  }
  const envelope = data as Record<string, unknown>;
  if (envelope["formatVersion"] !== 1) {
    throw new Error("Unsupported export formatVersion (expected 1).");
  }
  if (!Array.isArray(envelope["impressions"])) {
    throw new Error('Export file is missing an "impressions" array.');
  }

  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;
  for (const item of envelope["impressions"]) {
    try {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new Error("Impression entry must be an object.");
      }
      const record = normalizeLegacyRow(item as Record<string, unknown>);
      const { status } = await store.insertImpression(userId, record, JSON.stringify(item));
      if (status === "duplicate") duplicates += 1;
      else accepted += 1;
    } catch {
      rejected += 1;
    }
  }
  return { accepted, duplicates, rejected };
}
