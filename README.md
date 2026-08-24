# YouTube Ad Impressions

A privacy-first Chrome extension for observing, storing, and analyzing YouTube
video-ad impressions. All history stays in extension-owned IndexedDB storage.

## Load locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this directory.
4. Open a YouTube watch page and then open DevTools.

Click the extension toolbar icon to open the local analytics dashboard.

The content script logs a startup message plus `ad-start` and `ad-end` payloads prefixed with
`[YouTube Ad Impressions]`. It also dispatches the same payloads on `document`:

```js
document.addEventListener("youtube-ad-impression-transition", (event) => {
  console.log(event.detail);
});
```

For a quick status check, select the extension's content-script context in the
DevTools console context dropdown and run:

```js
__youtubeAdImpressionWatcher.active
```

From the normal page context, this installation check should return `"ready"`:

```js
document.documentElement.dataset.youtubeAdImpressionWatcher
```

## Test

```sh
npm test
```

## Current behavior

- Watches `#movie_player` for `ad-showing` or `ad-interrupting`.
- Deduplicates repeated class mutations into a single lifecycle.
- Watches `.ytp-visit-advertiser-link__text` during a pod and emits a separate
  `ad-impression-start` / `ad-impression-end` lifecycle for each domain change.
- Captures advertiser name/domain, headline, CTA, creative title, disclosure,
  pod position/size, avatar, media duration/state, skip availability, and player
  version from the active overlay.
- Marks an impression when its skip button is clicked.
- Commits completed impressions to the `impressions` store in `AdTrackerDB`.
- Tracks non-ad playback time to calculate ads per watch hour.
- Shows impression count, total ad time, skip rate, advertiser rankings, and
  recent history in the extension popup.
- Calculates elapsed duration on the end transition.
- Reattaches when YouTube replaces the player during SPA navigation.
- Ends an active lifecycle if the player is replaced or the page is hidden.

The actual advertiser landing URL is not available in the observed DOM; the
extension stores the displayed advertiser domain instead.
