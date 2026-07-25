import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  ADDON_ID,
  ARTIFACT_ROUTE,
  BASELINE_EVENT,
  COMMAND_ERROR_EVENT,
  COMMAND_EVENT,
  PANEL_ID,
  STATE_EVENT,
  STATUS_TYPE_ID,
  TEST_PROVIDER_ID,
} from "../src/constants.js";

const runtimeNamespace = "storybook-addon-visual-tests";
const runtimeFiles = {
  constants: new URL("../src/constants.ts", import.meta.url),
  preview: new URL("../src/preview.ts", import.meta.url),
  capture: new URL("../src/node/capture.ts", import.meta.url),
};
const legacyNamespace = ["lla", "me"].join("");
const workspaceNamespace = ["@", "workspace"].join("");

describe("runtime identifier contract", () => {
  test("uses one public namespace for addon IDs, channel events, and artifact routes", () => {
    expect(ADDON_ID).toBe(runtimeNamespace);
    expect(PANEL_ID).toBe(`${runtimeNamespace}/panel`);
    expect(TEST_PROVIDER_ID).toBe(`${runtimeNamespace}/provider`);
    expect(STATUS_TYPE_ID).toBe(`${runtimeNamespace}/status`);
    expect(COMMAND_EVENT).toBe(`${runtimeNamespace}/command`);
    expect(COMMAND_ERROR_EVENT).toBe(`${runtimeNamespace}/command-error`);
    expect(STATE_EVENT).toBe(`${runtimeNamespace}/state`);
    expect(BASELINE_EVENT).toBe(`${runtimeNamespace}/baseline`);
    expect(ARTIFACT_ROUTE).toBe("/__storybook_addon_visual_tests__/artifact");
  });

  test("keeps the preview bridge and runtime source free of internal namespaces", async () => {
    const sourceByFile = Object.fromEntries(
      await Promise.all(
        Object.entries(runtimeFiles).map(async ([name, file]) => [
          name,
          await readFile(file, "utf8"),
        ]),
      ),
    );
    const allRuntimeSource = Object.values(sourceByFile).join("\n");

    expect(sourceByFile.preview).toContain("__STORYBOOK_ADDON_VISUAL_TESTS__");
    expect(sourceByFile.capture).toContain("__STORYBOOK_ADDON_VISUAL_TESTS__");
    expect(allRuntimeSource).not.toContain(legacyNamespace);
    expect(allRuntimeSource).not.toContain(workspaceNamespace);
  });
});
