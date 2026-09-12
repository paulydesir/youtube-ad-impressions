const YOUTUBE_TABS = "https://www.youtube.com/*";

// Reattach to tabs that predate an install, reload, or worker restart.
export function registerAutomaticTracking(api = chrome) {
  async function attach(tabId: number) {
    try {
      await api.scripting.executeScript({ target: { tabId }, files: ["dist/content.js"] });
    } catch (error) {
      // A tab can close/navigate during injection, or site access can be withheld.
      console.info("[YouTube Ad Impressions] could not attach tracking", {
        tabId, reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  api.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status === "complete" && tab.url?.startsWith("https://www.youtube.com/")) {
      void attach(tabId);
    }
  });

  void api.tabs.query({ url: YOUTUBE_TABS }).then(tabs =>
    Promise.all(tabs.filter(tab => tab.id !== undefined && !tab.discarded)
      .map(tab => attach(tab.id!))),
  ).catch(error => console.info("[YouTube Ad Impressions] could not inspect open YouTube tabs", String(error)));
}
