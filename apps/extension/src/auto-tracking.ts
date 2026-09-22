const YOUTUBE_TABS = "https://www.youtube.com/*";

// Reattach to tabs that predate an install, reload, or worker restart.
export function registerAutomaticTracking(api = chrome): void {
  async function attach(tabId: number): Promise<void> {
    try {
      await api.scripting.executeScript({ target: { tabId }, files: ["dist/content.js"] });
    } catch {
      // A tab can close or navigate during injection, or site access
      // can be withheld. The next navigation reattaches.
    }
  }

  api.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status === "complete" && tab.url?.startsWith("https://www.youtube.com/")) {
      void attach(tabId);
    }
  });

  void api.tabs
    .query({ url: YOUTUBE_TABS })
    .then((tabs) => {
      const targets = tabs.filter((tab) => tab.id !== undefined && !tab.discarded);
      return Promise.all(targets.map((tab) => attach(tab.id as number)));
    })
    .catch(() => {
      // No open tabs or missing permission; future navigations still attach.
    });
}
