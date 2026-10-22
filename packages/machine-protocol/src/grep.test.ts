import { describe, expect, it } from "vitest";
import { FS_GREP_METHOD, fsGrepCursorKey } from "./index";

const SEARCH = {
  path: "/srv/app",
  globSuffix: "**/*.go",
  patterns: ["needle"],
  literal: false,
  ignoreCase: false,
};

describe("fs.grep", () => {
  it("names the search method", () => {
    expect(FS_GREP_METHOD).toBe("fs.grep");
  });

  it("gives one search the same cursor key on both sides of the wire", () => {
    expect(fsGrepCursorKey({ ...SEARCH })).toBe(
      fsGrepCursorKey({ ...SEARCH, patterns: ["needle"] }),
    );
  });

  it("keys a cursor on every search input", () => {
    const key = fsGrepCursorKey(SEARCH);
    const variants = [
      { ...SEARCH, path: "/srv/other" },
      { ...SEARCH, globSuffix: undefined },
      { ...SEARCH, globSuffix: "**/*.ts" },
      { ...SEARCH, patterns: ["other"] },
      { ...SEARCH, literal: true },
      { ...SEARCH, ignoreCase: true },
    ];
    const keys = variants.map((variant) => fsGrepCursorKey(variant));
    for (const variant of keys) expect(variant).not.toBe(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("distinguishes an absent glob from an empty one", () => {
    expect(fsGrepCursorKey({ ...SEARCH, globSuffix: undefined })).not.toBe(
      fsGrepCursorKey({ ...SEARCH, globSuffix: "" }),
    );
  });
});
