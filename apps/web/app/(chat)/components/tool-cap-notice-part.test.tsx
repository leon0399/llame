/**
 * Pure `parseCapNoticePart` shape handling only — the chip's rendered state
 * lives in tool-cap-notice-part.stories.tsx (docs/testing.md rule 5). Both
 * wire paths hand this function the same persisted `{ type, data }` part:
 * `toChatUiMessages` passes parts through verbatim, asserted in
 * lib/services/chat/history.test.ts.
 */

import { describe, expect, it } from "vitest";

import { parseCapNoticePart } from "./tool-cap-notice-part";

describe("parseCapNoticePart", () => {
  it("reads the SDK-native nested data-part shape", () => {
    expect(
      parseCapNoticePart({
        type: "data-cap-notice",
        data: { stepsUsed: 8, maxSteps: 8 },
      }),
    ).toEqual({ stepsUsed: 8, maxSteps: 8 });
  });

  it("falls back to a flat shape if the fields sit directly on the part", () => {
    expect(
      parseCapNoticePart({
        type: "data-cap-notice",
        stepsUsed: 3,
        maxSteps: 8,
      }),
    ).toEqual({ stepsUsed: 3, maxSteps: 8 });
  });

  it("returns null when required fields are missing or non-numeric, rather than rendering a broken chip", () => {
    expect(parseCapNoticePart({ type: "data-cap-notice" })).toBeNull();
    expect(
      parseCapNoticePart({
        type: "data-cap-notice",
        data: { stepsUsed: "8", maxSteps: 8 },
      }),
    ).toBeNull();
    expect(parseCapNoticePart(null)).toBeNull();
    expect(parseCapNoticePart("not-an-object")).toBeNull();
  });
});
