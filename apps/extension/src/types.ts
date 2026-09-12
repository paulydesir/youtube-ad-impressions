
export interface AdImpressionRecord {
  event_id?: string;
  pod_id?: string;
  advertiser_name: string | null;
  advertiser_url: string | null;
  host_video_id: string | null;
  timestamp: string;
  ended_at: string;
  duration_ms: number | null;
  pod_position: string | null;
  pod_index: number | null;
  pod_size: number | null;
  impression_index: number;
  skipped: boolean;
  skip_clicked_at: string | null;
  skip_available: boolean;
  ad_headline: string | null;
  call_to_action: string | null;
  creative_title: string | null;
  creative_duration_ms: number | null;
  muted: boolean | null;
  playback_rate: number | null;
  avatar_url: string | null;
  player_version: string | null;
  end_reason: string;
}

export interface IdentifiedAdImpressionRecord extends AdImpressionRecord {
  event_id: string;
  pod_id: string;
}

export interface RecordImpressionMessage {
  type: "record-impression";
  record: IdentifiedAdImpressionRecord;
}

export interface GetDashboardMessage {
  type: "get-dashboard";
}

export interface AddWatchTimeMessage {
  type: "add-watch-time";
  milliseconds: number;
}

export type ExtensionMessage =
  | RecordImpressionMessage
  | GetDashboardMessage
  | AddWatchTimeMessage;

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "record-impression" ||
    type === "get-dashboard" ||
    type === "add-watch-time"
  );
}
