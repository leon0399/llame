import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const testPackScript = path.join(packageRoot, "scripts", "test-pack.mjs");

/** Builds a tarball with a `package/` top-level entry, mirroring `npm pack`. */
async function createTarball(entries) {
  const workDirectory = await mkdtemp(
    path.join(os.tmpdir(), "storyproof-test-pack-fixture-"),
  );
  const packageDirectory = path.join(workDirectory, "package");
  await mkdir(packageDirectory, { recursive: true });

  for (const [relativePath, content] of Object.entries(entries)) {
    const filePath = path.join(packageDirectory, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  const archivePath = path.join(workDirectory, "archive.tgz");
  const tarred = spawnSync(
    "tar",
    ["-czf", archivePath, "-C", workDirectory, "package"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (tarred.status !== 0) {
    throw new Error(`Fixture tar failed:\n${tarred.stderr || tarred.stdout}`);
  }

  return {
    archivePath,
    cleanup: () => rm(workDirectory, { recursive: true, force: true }),
  };
}

function runTestPack(archivePath) {
  return spawnSync(process.execPath, [testPackScript, "--", archivePath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("test:pack inspector", () => {
  test("rejects a polluted archive, naming every offending entry", async () => {
    const { archivePath, cleanup } = await createTarball({
      "package.json": "{}",
      "README.md": "# storyproof",
      LICENSE: "MIT",
      "dist/index.js": "export {};",
      "src/index.ts": "export {};",
      "test/runner.test.ts": "// test",
      ".turbo/turbo-build.log": "cache",
      "AGENTS.md": "# agent notes",
      "docs/2026-07-24-public-preview-release-plan.md": "# plan",
      "__screenshots__/story/candidate.png": "not really a png",
    });

    try {
      const result = runTestPack(archivePath);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("package/src/index.ts");
      expect(result.stderr).toContain("package/test/runner.test.ts");
      expect(result.stderr).toContain("package/.turbo/turbo-build.log");
      expect(result.stderr).toContain("package/AGENTS.md");
      expect(result.stderr).toContain(
        "package/docs/2026-07-24-public-preview-release-plan.md",
      );
      expect(result.stderr).toContain(
        "package/__screenshots__/story/candidate.png",
      );
    } finally {
      await cleanup();
    }
  });

  test("accepts a fully allowlisted archive within the size budget", async () => {
    const { archivePath, cleanup } = await createTarball({
      "package.json": "{}",
      "README.md": "# storyproof",
      LICENSE: "MIT",
      "dist/index.js": "export {};",
      "dist/index.d.ts": "export {};",
      "dist/node/server.js": "export {};",
    });

    try {
      const result = runTestPack(archivePath);

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    } finally {
      await cleanup();
    }
  });

  test("rejects an allowlisted-only archive that exceeds the size budget", async () => {
    // Random (not repeated) bytes so gzip cannot compress the fixture back
    // under the budget it is meant to exercise.
    const oversizedContent = randomBytes(200 * 1024).toString("hex");
    const { archivePath, cleanup } = await createTarball({
      "package.json": "{}",
      "README.md": "# storyproof",
      LICENSE: "MIT",
      "dist/index.js": oversizedContent,
    });

    try {
      const result = runTestPack(archivePath);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/budget/);
    } finally {
      await cleanup();
    }
  });

  test("rejects an archive missing LICENSE even though every entry is allowlisted", async () => {
    const { archivePath, cleanup } = await createTarball({
      "package.json": "{}",
      "README.md": "# storyproof",
      "dist/index.js": "export {};",
    });

    try {
      const result = runTestPack(archivePath);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("package/LICENSE");
    } finally {
      await cleanup();
    }
  });

  test("rejects an archive with metadata but no compiled output", async () => {
    const { archivePath, cleanup } = await createTarball({
      "package.json": "{}",
      "README.md": "# storyproof",
      LICENSE: "MIT",
    });

    try {
      const result = runTestPack(archivePath);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/no compiled output present/);
    } finally {
      await cleanup();
    }
  });

  test("never rebuilds or repacks: the archive file is untouched", async () => {
    const { archivePath, cleanup } = await createTarball({
      "package.json": "{}",
      "README.md": "# storyproof",
      LICENSE: "MIT",
      "dist/index.js": "export {};",
    });

    try {
      const before = await stat(archivePath);
      runTestPack(archivePath);
      const after = await stat(archivePath);

      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(after.size).toBe(before.size);
    } finally {
      await cleanup();
    }
  });
});
