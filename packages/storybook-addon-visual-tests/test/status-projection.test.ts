import { describe, expect, test } from "vitest";

import { statusValueFor } from "../src/manager/state.js";
import type {
  VisualResult,
  VisualResultStatus,
} from "../src/shared/results.js";

function result(status: VisualResultStatus): VisualResult {
  return {
    runId: "run-1",
    storyId: "button--primary",
    title: "Button / Primary",
    importPath: "src/button.stories.tsx",
    environmentKey: "chromium-1280x720@1x",
    status,
  };
}

describe("statusValueFor", () => {
  test.each([
    ["queued", "status-value:pending"],
    ["running", "status-value:pending"],
    ["new", "status-value:new"],
    ["changed", "status-value:modified"],
    ["passed", "status-value:success"],
    ["capture-error", "status-value:error"],
    ["cancelled", "status-value:unknown"],
  ] as const)("maps %s to %s", (input, expected) => {
    expect(statusValueFor(result(input))).toBe(expected);
  });
});
