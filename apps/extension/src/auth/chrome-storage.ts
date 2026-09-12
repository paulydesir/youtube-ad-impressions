export function createChromeAuthStorage(storage: Pick<typeof chrome.storage.local, "get" | "set" | "remove">) {
  return {
    async getItem(key: string): Promise<string | null> {
      const values = await storage.get(key);
      return typeof values[key] === "string" ? values[key] : null;
    },
    async setItem(key: string, value: string) { await storage.set({ [key]: value }); },
    async removeItem(key: string) { await storage.remove(key); },
  };
}
