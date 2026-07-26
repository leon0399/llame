import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  assertArchiveTargetAbsent,
  validateArchiveOutputPath,
} from "../scripts/archive-paths.mjs";
import { isPathWithin } from "../scripts/path-containment.mjs";

describe("archive output paths", () => {
  test.each([
    ["relative archive", "artifact.tgz"],
    ["non-tarball extension", path.join(os.tmpdir(), "artifact.tar")],
    [
      "normalized alias",
      `${path.join(os.tmpdir(), "nested")}${path.sep}..${path.sep}artifact.tgz`,
    ],
    ["missing filename", path.join(os.tmpdir(), ".tgz")],
  ])("rejects %s", (_label, outputPath) => {
    expect(() =>
      validateArchiveOutputPath(outputPath, "/workspace/package"),
    ).toThrow();
  });

  test("rejects output inside the package workspace", () => {
    expect(() =>
      validateArchiveOutputPath(
        "/workspace/package/artifact.tgz",
        "/workspace/package",
      ),
    ).toThrow(/outside the package workspace/);
  });

  test("accepts an absolute normalized tarball path outside the workspace", () => {
    expect(
      validateArchiveOutputPath(
        path.join(os.tmpdir(), "artifacts", "package.tgz"),
        "/workspace/package",
      ),
    ).toBe(path.join(os.tmpdir(), "artifacts", "package.tgz"));
  });

  test("rejects an existing archive instead of overwriting it", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "archive-path-test-"),
    );
    const archive = path.join(directory, "existing.tgz");
    try {
      await writeFile(archive, "existing");
      await expect(assertArchiveTargetAbsent(archive)).rejects.toThrow(
        /already exists/,
      );
      await expect(
        assertArchiveTargetAbsent(path.join(directory, "missing.tgz")),
      ).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("canonical path containment", () => {
  test("accepts the root and its descendants", () => {
    expect(isPathWithin("/tmp/package/dist", "/tmp/package/dist")).toBe(true);
    expect(
      isPathWithin("/tmp/package/dist", "/tmp/package/dist/manager.js"),
    ).toBe(true);
  });

  test("rejects traversal, siblings, and prefix collisions", () => {
    expect(isPathWithin("/tmp/package/dist", "/tmp/package/index.js")).toBe(
      false,
    );
    expect(
      isPathWithin("/tmp/package/dist", "/tmp/package/dist-escape/x"),
    ).toBe(false);
    expect(
      isPathWithin("/tmp/package/dist", "/tmp/package/dist/../index.js"),
    ).toBe(false);
  });
});
