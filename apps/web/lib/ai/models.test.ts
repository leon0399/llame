import { describe, expect, it } from "vitest";

import { modelDisplayName } from "./models";

describe("modelDisplayName", () => {
  it("maps a known catalog id to its display name", () => {
    expect(modelDisplayName("openai:gpt-4o")).toBe("GPT-4o");
  });

  it("maps the BARE form of a catalog id too (live/persisted ids are unprefixed)", () => {
    expect(modelDisplayName("gpt-4o")).toBe("GPT-4o");
  });

  it("falls back to the provider-stripped tail for an unknown id", () => {
    expect(modelDisplayName("acme:custom-7b")).toBe("custom-7b");
  });

  it("returns the raw id when there is no provider prefix", () => {
    expect(modelDisplayName("mystery-model")).toBe("mystery-model");
  });
});
