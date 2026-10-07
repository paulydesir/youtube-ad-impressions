// Included only by zap; ordinary release builds have no reload watcher.
{
  const build = __ZAP_BUILD__;
  const alarm = 'zap:check-build';
  let reloading = false;
  async function checkBuild() {
    try {
      const response = await fetch(chrome.runtime.getURL('dist/zap-build.json'), { cache: 'no-store' });
      if (!response.ok) return;
      const next = await response.json();
      if (next.build && next.build !== build && !reloading) {
        reloading = true;
        chrome.runtime.reload();
      }
    } catch {
      // A build may be in progress. Retry on the next alarm.
    }
  }
  chrome.alarms.onAlarm.addListener(event => {
    if (event.name === alarm) void checkBuild();
  });
  void chrome.alarms.create(alarm, { periodInMinutes: 0.5 });
  void checkBuild();
}
