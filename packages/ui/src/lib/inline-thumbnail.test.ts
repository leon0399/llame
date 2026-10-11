import { describe, expect, it } from "vitest";

import { inlineThumbnailSchema } from "./inline-thumbnail.js";

const PREFIX = "data:image/webp;base64,";

describe("inlineThumbnailSchema", () => {
  it("accepts a base64 WebP data URL", () => {
    expect(inlineThumbnailSchema.safeParse(`${PREFIX}UklGRg==`).success).toBe(
      true,
    );
  });

  it("accepts a data URL of at most 65,536 characters", () => {
    const longest = PREFIX + "A".repeat(65_536 - PREFIX.length);
    expect(inlineThumbnailSchema.safeParse(longest).success).toBe(true);
    expect(inlineThumbnailSchema.safeParse(`${longest}A`).success).toBe(false);
  });

  it.each([
    ["another image type", "data:image/png;base64,iVBORw0KGgo="],
    ["a remote URL", "https://example.com/shot.webp"],
    ["a non-base64 payload", `${PREFIX}<svg/>`],
    ["an empty payload", PREFIX],
    ["a non-string", 42],
  ])("rejects %s", (_label, value) => {
    expect(inlineThumbnailSchema.safeParse(value).success).toBe(false);
  });
});
