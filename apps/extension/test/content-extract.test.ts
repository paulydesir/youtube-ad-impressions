import assert from "node:assert/strict";
import test from "node:test";
import {
  extractAdMetadata,
  extractAdvertiserDomain,
  extractText,
  hostVideoIdFromHref,
  isSkipButtonClick,
} from "../src/content/extract.ts";
import { YOUTUBE_SELECTORS } from "../src/content/selectors.ts";


interface FakeElementOptions {
  textContent?: string | null;
  attributes?: Record<string, string>;
  closestResult?: unknown;
}

function fakeElement(options: FakeElementOptions = {}): Element {
  return {
    textContent: options.textContent ?? null,
    getAttribute: (name: string) => options.attributes?.[name] ?? null,
    closest: (_selector: string) => (options.closestResult ?? null) as Element,
  } as unknown as Element;
}

function fakePlayer(
  entries: Record<string, Element | null>,
  extra: Record<string, unknown> = {},
): Element {
  return {
    querySelector: (selector: string) =>
      Object.hasOwn(entries, selector) ? (entries[selector] ?? null) : null,
    contains: () => true,
    ...extra,
  } as unknown as Element;
}

test("extractText prefers trimmed text over aria-label", () => {
  const player = fakePlayer({
    ".x": fakeElement({ textContent: "  Coursera  ", attributes: {} }),
  });
  assert.equal(extractText(player, ".x"), "Coursera");
});

test("extractText falls back to aria-label, else null", () => {
  const player = fakePlayer({
    ".empty": fakeElement({
      textContent: "   ",
      attributes: { "aria-label": "Advertisement" },
    }),
    ".missing": null,
    ".blank": fakeElement({ textContent: null, attributes: {} }),
  });
  assert.equal(extractText(player, ".empty"), "Advertisement");
  assert.equal(extractText(player, ".missing"), null);
  assert.equal(extractText(player, ".blank"), null);
  assert.equal(extractText(null, ".missing"), null);
});

test("extractAdvertiserDomain trims without aria-label fallback", () => {
  const player = fakePlayer({
    [YOUTUBE_SELECTORS.advertiserDomain]: fakeElement({
      textContent: "  example.com  ",
      attributes: { "aria-label": "ignored" },
    }),
  });
  assert.equal(extractAdvertiserDomain(player), "example.com");
  assert.equal(extractAdvertiserDomain(null), null);
});

test("extractAdMetadata snapshots every field from the player", () => {
  const skipButton = fakeElement({});
  const player = fakePlayer(
    {
      [YOUTUBE_SELECTORS.advertiserDomain]: fakeElement({
        textContent: "example.com",
      }),
      [YOUTUBE_SELECTORS.advertiserName]: fakeElement({
        textContent: "Example",
      }),
      [YOUTUBE_SELECTORS.adHeadline]: fakeElement({
        textContent: "Save big",
      }),
      [YOUTUBE_SELECTORS.callToAction]: fakeElement({ textContent: "Buy" }),
      [YOUTUBE_SELECTORS.creativeTitle]: fakeElement({
        textContent: "Creative",
      }),
      [YOUTUBE_SELECTORS.disclosureLabel]: fakeElement({ textContent: "Ad" }),
      [YOUTUBE_SELECTORS.podLabel]: fakeElement({ textContent: "1 of 2" }),
      [YOUTUBE_SELECTORS.avatar]: fakeElement({ textContent: null }) as Element,
      [YOUTUBE_SELECTORS.skipButton]: skipButton,
      [YOUTUBE_SELECTORS.video]: {
        duration: 30,
        currentTime: 5.25,
        muted: true,
        playbackRate: 1,
      } as unknown as Element,
    },
    { dataset: { version: "1.2.3" } },
  );
  const avatar = player.querySelector(
    YOUTUBE_SELECTORS.avatar,
  ) as unknown as Record<string, unknown>;
  avatar["currentSrc"] = "";
  avatar["src"] = "https://example.com/avatar.png";

  const metadata = extractAdMetadata(player);

  assert.equal(metadata.advertiserDomain, "example.com");
  assert.equal(metadata.advertiserName, "Example");
  assert.equal(metadata.adHeadline, "Save big");
  assert.equal(metadata.callToAction, "Buy");
  assert.equal(metadata.creativeTitle, "Creative");
  assert.equal(metadata.disclosureLabel, "Ad");
  assert.equal(metadata.podLabel, "1 of 2");
  assert.equal(metadata.podPosition, 1);
  assert.equal(metadata.podSize, 2);
  assert.equal(metadata.skipAvailableAtCapture, true);
  assert.equal(metadata.creativeDurationMs, 30000);
  assert.equal(metadata.creativeCurrentTimeMs, 5250);
  assert.equal(metadata.creativeMutedAtCapture, true);
  assert.equal(metadata.creativePlaybackRate, 1);
  assert.equal(metadata.avatarUrl, "https://example.com/avatar.png");
  assert.equal(metadata.playerVersion, "1.2.3");
});

test("extractAdMetadata tolerates a missing player", () => {
  const metadata = extractAdMetadata(null);
  assert.equal(metadata.advertiserDomain, null);
  assert.equal(metadata.podPosition, null);
  assert.equal(metadata.skipAvailableAtCapture, false);
  assert.equal(metadata.creativeDurationMs, null);
  assert.equal(metadata.creativeMutedAtCapture, null);
  assert.equal(metadata.avatarUrl, null);
  assert.equal(metadata.playerVersion, null);
});

test("hostVideoIdFromHref reads ?v= and never throws", () => {
  assert.equal(
    hostVideoIdFromHref("https://www.youtube.com/watch?v=abc123&t=5s"),
    "abc123",
  );
  assert.equal(hostVideoIdFromHref("https://www.youtube.com/"), null);
  assert.equal(hostVideoIdFromHref("not a url"), null);
});

test("isSkipButtonClick only matches presses inside the player", () => {
  const skipButton = fakeElement({});
  const player = {
    contains: (node: unknown) => node === skipButton,
  };
  const press = (target: unknown) => ({ target }) as unknown as Event;

  const inside = fakeElement({});
  (inside as unknown as { closest: () => unknown }).closest = () => skipButton;
  assert.equal(isSkipButtonClick(press(inside), player), true);

  const outside = fakeElement({});
  (outside as unknown as { closest: () => unknown }).closest = () =>
    fakeElement({});
  assert.equal(isSkipButtonClick(press(outside), player), false);

  assert.equal(isSkipButtonClick(press(null), player), false);
  assert.equal(isSkipButtonClick(press({}), player), false);
  assert.equal(isSkipButtonClick(press(inside), null), false);
});
