const YOUTUBE_AD_STATS_REQUESTS = ["https://www.youtube.com/api/stats/ads*"];

export function registerAdVideoIdLogger(api = chrome): void {
  if (!api.webRequest?.onBeforeRequest) {
    return;
  }
  api.webRequest.onBeforeRequest.addListener(
    (details) => {
      const url = new URL(details.url);
      if (url.pathname !== "/api/stats/ads") {
        return;
      }
      const adVideoId = url.searchParams.get("ad_v");
      if (!adVideoId) {
        return;
      }
      if (details.tabId >= 0) {
        // Route only to the originating tab's top-level content script.
        // A closed tab or missing receiver must not affect recording.
        void api.tabs
          .sendMessage(details.tabId, { type: "ad-video-id", adVideoId }, { frameId: 0 })
          .catch(() => undefined);
      }
    },
    { urls: YOUTUBE_AD_STATS_REQUESTS },
  );
}
