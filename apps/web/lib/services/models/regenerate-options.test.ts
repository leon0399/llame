import { describe, expect, it } from "vitest";

import { regenerateModelOptions } from "./regenerate-options";

const m = (id: string, name: string) => ({ id, name });

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
});
