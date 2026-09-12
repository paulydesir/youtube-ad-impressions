const WATCH_TIME_KEY = "youtubeWatchTimeMs";

export interface WatchTimeStore {
  addWatchTime(milliseconds: number): Promise<void>;
  getWatchTime(): Promise<number>;
  setWatchTime(value: number): Promise<void>;
}

async function getWatchTime(): Promise<number> {
  const values = await chrome.storage.local.get(WATCH_TIME_KEY);
  const value = values[WATCH_TIME_KEY];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function addWatchTime(milliseconds: number): Promise<void> {
  await chrome.storage.local.set({ [WATCH_TIME_KEY]: (await getWatchTime()) + milliseconds });
}

async function setWatchTime(value: number): Promise<void> {
  await chrome.storage.local.set({ [WATCH_TIME_KEY]: value });
}

export function createChromeWatchTimeStore(): WatchTimeStore {
  return { addWatchTime, getWatchTime, setWatchTime };
}
