import { describe, expect, test } from "vitest";

import {
  findDisallowedTarballEntries,
  findMissingRequiredEntries,
  isAllowedTarballEntry,
  MAX_PACKED_ARCHIVE_SIZE_BYTES,
} from "../../scripts/pack-inventory.mjs";

describe("tarball allowlist", () => {
  test.each([
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/dist/node/server.js",
    "package/dist/node/server.d.ts.map",
    "package/dist",
    "package",
    "package/LICENSE",
    "package/README.md",
    "package/package.json",
  ])("allows %s", (entryName) => {
    expect(isAllowedTarballEntry(entryName)).toBe(true);
  });

  test.each([
    ["source", "package/src/index.ts"],
    ["unit tests", "package/test/runner.test.ts"],
    ["stories", "package/src/preview.stories.tsx"],
    ["turbo cache", "package/.turbo/turbo-build.log"],
    ["test-results", "package/test-results/results.json"],
    ["temporary Storybook output", "package/storybook-static/index.html"],
    ["candidate/diff images", "package/__screenshots__/foo/candidate.png"],
    ["agent instructions", "package/AGENTS.md"],
    ["agent instructions symlink", "package/CLAUDE.md"],
    ["design docs", "package/docs/capture-contract.md"],
    ["roadmap", "package/ROADMAP.md"],
    [
      "plan documents",
      "package/docs/2026-07-24-public-preview-release-plan.md",
    ],
    ["dist-name-collision sibling", "package/dist-evil/index.js"],
    ["dist-name-collision file", "package/distfoo"],
    ["build config", "package/tsconfig.build.json"],
    ["scripts", "package/scripts/build.mjs"],
    ["parent-directory traversal to repo root", "package/dist/../../AGENTS.md"],
    ["parent-directory traversal to source", "package/dist/../src/index.ts"],
    ["current-directory segment", "package/./dist/index.js"],
    ["empty path segment", "package//dist/index.js"],
  ])("rejects %s (%s)", (_label, entryName) => {
    expect(isAllowedTarballEntry(entryName)).toBe(false);
  });
});

describe("findDisallowedTarballEntries", () => {
  test("returns only the offending entries, in order", () => {
    const entries = [
      "package/package.json",
      "package/src/index.ts",
      "package/dist/index.js",
      "package/AGENTS.md",
    ];

    expect(findDisallowedTarballEntries(entries)).toEqual([
      "package/src/index.ts",
      "package/AGENTS.md",
    ]);
  });

  test("returns an empty array for a fully allowlisted entry set", () => {
    expect(
      findDisallowedTarballEntries([
        "package/dist/index.js",
        "package/LICENSE",
        "package/README.md",
        "package/package.json",
      ]),
    ).toEqual([]);
  });
});

describe("findMissingRequiredEntries", () => {
  test("requires LICENSE, README.md, package.json, and at least one dist entry", () => {
    expect(findMissingRequiredEntries(["package/dist/index.js"])).toEqual(
      expect.arrayContaining([
        "package/LICENSE",
        "package/README.md",
        "package/package.json",
      ]),
    );
  });

  test("flags a missing LICENSE alone", () => {
    expect(
      findMissingRequiredEntries([
        "package/README.md",
        "package/package.json",
        "package/dist/index.js",
      ]),
    ).toEqual(["package/LICENSE"]);
  });

  test("flags an archive with no dist output even if metadata is present", () => {
    expect(
      findMissingRequiredEntries([
        "package/LICENSE",
        "package/README.md",
        "package/package.json",
      ]),
    ).toEqual(["package/dist/** (no compiled output present)"]);
  });

  test("returns an empty array once every required entry is present", () => {
    expect(
      findMissingRequiredEntries([
        "package/LICENSE",
        "package/README.md",
        "package/package.json",
        "package/dist/index.js",
      ]),
    ).toEqual([]);
  });
});

describe("packed archive size budget", () => {
  test("is a positive, documented constant with headroom over the measured baseline", () => {
    // Measured 2026-07-26: the clean archive (dist + LICENSE + README.md +
    // package.json, including sourcemaps and declarations) packs to about
    // 46 kB (pack output is not byte-deterministic across runs). The
    // budget must stay comfortably above that ~46 kB measured baseline
    // while still catching a real leak (which would add many times that
    // size).
    expect(MAX_PACKED_ARCHIVE_SIZE_BYTES).toBeGreaterThan(46306);
    expect(MAX_PACKED_ARCHIVE_SIZE_BYTES).toBeLessThan(46306 * 10);
  });
});
