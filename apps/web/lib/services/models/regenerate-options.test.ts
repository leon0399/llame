import { describe, expect, it } from "vitest";

import { dedupeModelsById, regenerateModelOptions } from "./regenerate-options";

const m = (id: string, name: string) => ({ id, name });

describe("dedupeModelsById", () => {
  it("keeps the first of each id, order preserved", () => {
    expect(
      dedupeModelsById([m("a", "A1"), m("b", "B"), m("a", "A2")]).map(
        (x) => x.name,
      ),
    ).toEqual(["A1", "B"]);
  });
});

describe("regenerateModelOptions", () => {
  it("offers every available model except the current one, order preserved", () => {
    expect(
      regenerateModelOptions(
        [m("a", "A"), m("b", "B"), m("c", "C")],
        "b",
      ).map((x) => x.id),
    ).toEqual(["a", "c"]);
  });

  it("is empty when only the current model is available", () => {
    expect(regenerateModelOptions([m("a", "A")], "a")).toEqual([]);
  });

  it("keeps a lone model whose id differs from currentId (stale selection)", () => {
    // currentId not in the set (e.g. a stale/static selection) → nothing to
    // exclude, so every available model is offered as an alternative.
    expect(regenerateModelOptions([m("a", "A")], "z").map((x) => x.id)).toEqual([
      "a",
    ]);
  });

  it("is empty when there are no models", () => {
    expect(regenerateModelOptions([], "a")).toEqual([]);
  });

  it("dedupes shared ids, so duplicate accounts don't offer the same model twice", () => {
    // two BYOK accounts, same defaultModel "a", plus a distinct "b"
    expect(
      regenerateModelOptions([m("a", "A"), m("a", "A"), m("b", "B")], "a").map(
        (x) => x.id,
      ),
    ).toEqual(["b"]);
  });
});
