import { describe, expect, it } from "vitest";

import { archiveScopeFromListKey, knowledgeSpaceQueryKeys } from "./queries";

describe("knowledgeSpaceQueryKeys", () => {
  it("keeps the active, archived, and combined lists under one list prefix", () => {
    expect(knowledgeSpaceQueryKeys.list()).toEqual([
      "knowledge-spaces",
      "list",
      "active",
    ]);
    expect(knowledgeSpaceQueryKeys.list("only")).toEqual([
      "knowledge-spaces",
      "list",
      "only",
    ]);
    expect(knowledgeSpaceQueryKeys.list("with")).toEqual([
      "knowledge-spaces",
      "list",
      "with",
    ]);
    expect(knowledgeSpaceQueryKeys.list("only").slice(0, 2)).toEqual(
      knowledgeSpaceQueryKeys.lists(),
    );
  });

  it("reads the archive filter from the list key", () => {
    expect(
      archiveScopeFromListKey(knowledgeSpaceQueryKeys.list()),
    ).toBeUndefined();
    expect(archiveScopeFromListKey(knowledgeSpaceQueryKeys.list("only"))).toBe(
      "only",
    );
    expect(archiveScopeFromListKey(knowledgeSpaceQueryKeys.list("with"))).toBe(
      "with",
    );
  });
});
