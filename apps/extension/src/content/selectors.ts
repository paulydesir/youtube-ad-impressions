export const PLAYER_SELECTOR = "#movie_player";

export const YOUTUBE_SELECTORS = {
  player: PLAYER_SELECTOR,
  advertiserDomain: ".ytp-visit-advertiser-link__text",
  advertiserName: ".ytp-ad-avatar-lockup-card__description",
  adHeadline: ".ytp-ad-avatar-lockup-card__headline",
  callToAction: ".ytp-ad-button-vm__text",
  creativeTitle: ".ytp-title-text .ytp-title-link",
  disclosureLabel: ".ytp-ad-badge__text--clean-player",
  podLabel: ".ytp-ad-pod-index .ad-simple-attributed-string",
  avatar: "img.ytp-ad-avatar",
  skipButton: ".ytp-skip-ad-button",
  video: "video.html5-main-video",
} as const;
