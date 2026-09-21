const YOUTUBE_AD_STATS_REQUESTS = ["https://www.youtube.com/api/stats/ads*"];

export function registerAdVideoIdLogger(api = chrome) {
  if (!api.webRequest?.onBeforeRequest) {
    console.error("[YouTube Ad] listener unavailable: reload the extension in chrome://extensions to apply the webRequest permission.");
    return;
  }
  let reportedMissingId = false;
  api.webRequest.onBeforeRequest.addListener(
    details => {
      const url = new URL(details.url);
      if (url.pathname !== "/api/stats/ads") return;

      const adVideoId = url.searchParams.get("ad_v");
      if (adVideoId) {
        console.log("[YouTube Ad] video ID:", adVideoId);
      } else if (!reportedMissingId) {
        reportedMissingId = true;
        console.info("[YouTube Ad] telemetry observed, but this request has no ad_v; waiting for an ad video ID.");
      }
    },
    { urls: YOUTUBE_AD_STATS_REQUESTS },
  );
  console.info("[YouTube Ad] ad video ID listener ready (service-worker console).");
}
