// Deduplicates repeated YouTube player observations into single ad lifecycles:
// one `AdStateMachine` per player ad-pod, one `DomainImpressionTracker`
// impression per advertiser-domain change within the pod.

export const AD_CLASSES = ["ad-showing", "ad-interrupting"] as const;

interface ClassListLike {
  contains(className: string): boolean;
}

export function playerIsShowingAd(
  player: { classList: ClassListLike } | null | undefined,
): boolean {
  return Boolean(
    player && AD_CLASSES.some((className) => player.classList.contains(className)),
  );
}

/** Extra caller context merged into the emitted transition detail. */
export type TransitionContext = Record<string, unknown>;

export interface AdStartDetail extends TransitionContext {
  startedAtMs: number;
}

export interface AdEndDetail extends TransitionContext {
  startedAtMs: number | null;
  endedAtMs: number;
  durationMs: number | null;
}

export interface AdStateMachineOptions {
  onStart?: (detail: AdStartDetail) => void;
  onEnd?: (detail: AdEndDetail) => void;
  now?: () => number;
}

export class AdStateMachine {
  private readonly onStart?: (detail: AdStartDetail) => void;
  private readonly onEnd?: (detail: AdEndDetail) => void;
  private readonly now: () => number;
  active = false;
  private startedAtMs: number | null = null;

  constructor({ onStart, onEnd, now = () => Date.now() }: AdStateMachineOptions) {
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.now = now;
  }

  update(nextActive: boolean, context: TransitionContext = {}): void {
    if (nextActive === this.active) return;

    const transitionAtMs = this.now();
    this.active = nextActive;

    if (nextActive) {
      this.startedAtMs = transitionAtMs;
      this.onStart?.({ startedAtMs: transitionAtMs, ...context });
      return;
    }

    const startedAtMs = this.startedAtMs;
    this.startedAtMs = null;
    this.onEnd?.({
      startedAtMs,
      endedAtMs: transitionAtMs,
      durationMs:
        startedAtMs === null ? null : Math.max(0, transitionAtMs - startedAtMs),
      ...context,
    });
  }

  reset(context: TransitionContext = {}): void {
    if (this.active) this.update(false, context);
  }
}

export interface ImpressionStartDetail extends TransitionContext {
  eventId: string;
  podId: string;
  advertiserDomain: string;
  impressionIndex: number;
  startedAtMs: number;
}

export interface ImpressionEndDetail extends TransitionContext {
  eventId: string;
  podId: string;
  advertiserDomain: string;
  impressionIndex: number;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  reason: string;
}

export interface DomainImpressionTrackerOptions {
  onStart?: (detail: ImpressionStartDetail) => void;
  onEnd?: (detail: ImpressionEndDetail) => void;
  now?: () => number;
  createId?: () => string;
}

export class DomainImpressionTracker {
  private readonly onStart?: (detail: ImpressionStartDetail) => void;
  private readonly onEnd?: (detail: ImpressionEndDetail) => void;
  private readonly now: () => number;
  private readonly createId: () => string;
  private podActive = false;
  private podId: string | null = null;
  private eventId: string | null = null;
  private domain: string | null = null;
  private startedAtMs: number | null = null;
  impressionIndex = 0;

  constructor({
    onStart,
    onEnd,
    now = () => Date.now(),
    createId = () => crypto.randomUUID(),
  }: DomainImpressionTrackerOptions) {
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.now = now;
    this.createId = createId;
  }

  beginPod(): void {
    this.endPod({ reason: "pod-restarted" });
    this.podActive = true;
    this.podId = this.createId();
    this.impressionIndex = 0;
  }

  updateDomain(value: string | null | undefined, context: TransitionContext = {}): void {
    if (!this.podActive) return;

    const nextDomain = value?.trim().toLowerCase() || null;
    if (nextDomain === this.domain) return;

    const transitionAtMs = this.now();
    if (this.domain && this.eventId && this.podId) {
      this.onEnd?.({
        eventId: this.eventId,
        podId: this.podId,
        advertiserDomain: this.domain,
        impressionIndex: this.impressionIndex,
        startedAtMs: this.startedAtMs ?? transitionAtMs,
        endedAtMs: transitionAtMs,
        durationMs: Math.max(0, transitionAtMs - (this.startedAtMs ?? transitionAtMs)),
        reason: nextDomain ? "advertiser-changed" : "advertiser-hidden",
        ...context,
      });
    }

    this.domain = nextDomain;
    this.startedAtMs = nextDomain ? transitionAtMs : null;
    this.eventId = nextDomain ? this.createId() : null;

    if (nextDomain && this.eventId && this.podId) {
      this.impressionIndex += 1;
      this.onStart?.({
        eventId: this.eventId,
        podId: this.podId,
        advertiserDomain: nextDomain,
        impressionIndex: this.impressionIndex,
        startedAtMs: transitionAtMs,
        ...context,
      });
    }
  }

  endPod(context: TransitionContext = {}): void {
    if (this.domain) this.updateDomain(null, context);
    this.podActive = false;
    this.podId = null;
    this.eventId = null;
    this.domain = null;
    this.startedAtMs = null;
  }
}
