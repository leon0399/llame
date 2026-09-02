import { describe, expect, it } from "vitest";

import { addAppUtm } from "./url";

describe("addAppUtm", () => {
  it("appends the llame utm_source to a bare URL", () => {
    expect(addAppUtm("https://example.com/path")).toBe(
      "https://example.com/path?utm_source=llame.chat",
    );
  });

  it("overwrites an existing utm_source rather than duplicating the param", () => {
    expect(addAppUtm("https://example.com/?utm_source=other")).toBe(
      "https://example.com/?utm_source=llame.chat",
    );
  });

  it("returns the original string unchanged when it is not a parseable URL", () => {
    expect(addAppUtm("not a url")).toBe("not a url");
  });
});
