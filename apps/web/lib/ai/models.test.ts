import { describe, expect, it } from "vitest";

import { STATIC_CHAT_MODELS, findCatalogModel, modelDisplayName } from "./models";

describe("STATIC_CHAT_MODELS bare-tail uniqueness (dual-key invariant)", () => {
  it("has no two entries sharing a bare tail", () => {
    // findCatalogModel keys on the bare tail (first-catalog-wins). A colliding
    // tail would silently map a live bare id to whichever entry is declared
    // first — this guards that invariant against a future catalog addition.
    const tails = STATIC_CHAT_MODELS.map((m) => {
      const colon = m.id.indexOf(":");
      return colon >= 0 ? m.id.slice(colon + 1) : m.id;
    });
    expect(new Set(tails).size).toBe(tails.length);
  });
});

describe("findCatalogModel", () => {
  it("resolves a prefixed catalog id to its full entry", () => {
    const m = findCatalogModel("openai:gpt-4o");
    expect(m?.name).toBe("GPT-4o");
    expect(m?.description).toBeTruthy();
  });

  it("resolves the BARE form too (live ids are unprefixed)", () => {
    // the fix: a bare live id must find its catalog metadata
    expect(findCatalogModel("gpt-4o")?.name).toBe("GPT-4o");
  });

  it("is undefined for an id not in the catalog", () => {
    expect(findCatalogModel("some-custom-model")).toBeUndefined();
  });
});

describe("modelDisplayName", () => {
  it("maps a known catalog id to its display name", () => {
    expect(modelDisplayName("openai:gpt-4o")).toBe("GPT-4o");
  });

  it("maps the BARE form of a catalog id too (live ids are unprefixed)", () => {
    expect(modelDisplayName("gpt-4o")).toBe("GPT-4o");
  });

  it("falls back to the provider-stripped tail for an unknown id", () => {
    expect(modelDisplayName("acme:custom-7b")).toBe("custom-7b");
  });

  it("returns the raw id when there is no provider prefix", () => {
    expect(modelDisplayName("mystery-model")).toBe("mystery-model");
  });
});
