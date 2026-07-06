import { describe, expect, it } from "vitest";

import { modelContextWindow, modelDisplayName } from "./models";

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

describe("modelContextWindow", () => {
  it("returns the catalog context window for a known bare id", () => {
    expect(modelContextWindow("gpt-4o")).toBe(128000);
  });

  it("returns the catalog context window for a known prefixed id", () => {
    expect(modelContextWindow("openai:gpt-4.1")).toBe(1_047_576);
  });

  it("returns undefined for an unknown model id", () => {
    expect(modelContextWindow("acme:custom-7b")).toBeUndefined();
  });

  it("returns undefined for a catalog model with no declared context window", () => {
    expect(modelContextWindow("xai:grok-3-mini")).toBeUndefined();
  });
});
