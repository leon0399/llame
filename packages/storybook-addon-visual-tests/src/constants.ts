export const ADDON_ID = "llame/visual-tests";
export const PANEL_ID = `${ADDON_ID}/panel`;
export const TEST_PROVIDER_ID = `${ADDON_ID}/provider`;
export const STATUS_TYPE_ID = `${ADDON_ID}/status`;

export const COMMAND_EVENT = `${ADDON_ID}/command`;
export const STATE_EVENT = `${ADDON_ID}/state`;
export const ARTIFACT_ROUTE = "/__llame_visual_tests__/artifact";

export const DEFAULT_ENVIRONMENT = {
  browserName: "chromium",
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  key: "chromium-1280x720@1x",
} as const;
