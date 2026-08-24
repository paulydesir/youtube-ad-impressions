(function exposeAdStateMachine(global) {
  "use strict";

  const AD_CLASSES = ["ad-showing", "ad-interrupting"];

  function playerIsShowingAd(player) {
    return Boolean(
      player && AD_CLASSES.some((className) => player.classList.contains(className)),
    );
  }

  class AdStateMachine {
    constructor({ onStart, onEnd, now = () => Date.now() }) {
      this.onStart = onStart;
      this.onEnd = onEnd;
      this.now = now;
      this.active = false;
      this.startedAtMs = null;
    }

    update(nextActive, context = {}) {
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

    reset(context = {}) {
      if (this.active) this.update(false, context);
    }
  }

  class DomainImpressionTracker {
    constructor({ onStart, onEnd, now = () => Date.now() }) {
      this.onStart = onStart;
      this.onEnd = onEnd;
      this.now = now;
      this.podActive = false;
      this.domain = null;
      this.startedAtMs = null;
      this.impressionIndex = 0;
    }

    beginPod() {
      this.endPod({ reason: "pod-restarted" });
      this.podActive = true;
      this.impressionIndex = 0;
    }

    updateDomain(value, context = {}) {
      if (!this.podActive) return;

      const nextDomain = value?.trim().toLowerCase() || null;
      if (nextDomain === this.domain) return;

      const transitionAtMs = this.now();
      if (this.domain) {
        this.onEnd?.({
          advertiserDomain: this.domain,
          impressionIndex: this.impressionIndex,
          startedAtMs: this.startedAtMs,
          endedAtMs: transitionAtMs,
          durationMs: Math.max(0, transitionAtMs - this.startedAtMs),
          reason: nextDomain ? "advertiser-changed" : "advertiser-hidden",
          ...context,
        });
      }

      this.domain = nextDomain;
      this.startedAtMs = nextDomain ? transitionAtMs : null;

      if (nextDomain) {
        this.impressionIndex += 1;
        this.onStart?.({
          advertiserDomain: nextDomain,
          impressionIndex: this.impressionIndex,
          startedAtMs: transitionAtMs,
          ...context,
        });
      }
    }

    endPod(context = {}) {
      if (this.domain) this.updateDomain(null, context);
      this.podActive = false;
      this.domain = null;
      this.startedAtMs = null;
    }
  }

  global.YouTubeAdWatcher = {
    AD_CLASSES,
    AdStateMachine,
    DomainImpressionTracker,
    playerIsShowingAd,
  };
})(globalThis);
