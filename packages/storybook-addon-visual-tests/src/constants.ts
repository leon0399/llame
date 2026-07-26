export const ADDON_ID = "storyproof";
export const PANEL_ID = `${ADDON_ID}/panel`;
export const TEST_PROVIDER_ID = `${ADDON_ID}/provider`;
export const STATUS_TYPE_ID = `${ADDON_ID}/status`;

export const COMMAND_EVENT = `${ADDON_ID}/command`;
export const COMMAND_ERROR_EVENT = `${ADDON_ID}/command-error`;
export const STATE_EVENT = `${ADDON_ID}/state`;
export const BASELINE_EVENT = `${ADDON_ID}/baseline`;
export const ARTIFACT_ROUTE = "/__storyproof__/artifact";

export const DEFAULT_ENVIRONMENT = {
  browserName: "chromium",
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  key: "chromium-1280x720@1x",
} as const;
