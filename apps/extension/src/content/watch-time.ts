// Accumulates non-ad video watch time and forwards it in batches.
// Pure timing logic: the video element and ad state arrive via callbacks so
// tests never need a player, a timer, or Chrome.
export const WATCH_SAMPLE_CAP_MS = 2000;
export const WATCH_FLUSH_THRESHOLD_MS = 10_000;

export interface WatchTimeTrackerOptions {
  isAdActive: () => boolean;
  getVideo: () => { paused: boolean } | null;
  sendWatchTime: (milliseconds: number) => void;
  now?: () => number;
  sampleCapMs?: number;
  flushThresholdMs?: number;
}

export interface WatchTimeTracker {
  sample(): void;
  flush(): void;
  readonly pendingMs: number;
}

export function createWatchTimeTracker(
  options: WatchTimeTrackerOptions,
): WatchTimeTracker {
  const {
    isAdActive,
    getVideo,
    sendWatchTime,
    now = () => performance.now(),
    sampleCapMs = WATCH_SAMPLE_CAP_MS,
    flushThresholdMs = WATCH_FLUSH_THRESHOLD_MS,
  } = options;
  let pendingMs = 0;
  let lastTickMs: number | null = null;

  function flush(): void {
    if (pendingMs < 1) return;
    const milliseconds = Math.round(pendingMs);
    pendingMs = 0;
    sendWatchTime(milliseconds);
  }

  function sample(): void {
    const tickMs = now();
    const video = getVideo();

    if (lastTickMs !== null && video && !video.paused && !isAdActive()) {
      // The cap prevents sleep/wake or a suspended tab from phantom hours.
      pendingMs += Math.min(sampleCapMs, tickMs - lastTickMs);
    }
    lastTickMs = tickMs;

    if (pendingMs >= flushThresholdMs) flush();
  }

  return {
    sample,
    flush,
    get pendingMs() {
      return pendingMs;
    },
  };
}
