import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PNG } from "pngjs";
import { afterEach, describe, expect, test } from "vitest";

import {
  approveCandidate,
  type ApprovalRequest,
  type CompletedVisualResult,
} from "../src/node/approval.js";
import type { BaselineMetadata } from "../src/shared/results.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        import("node:fs/promises").then(({ rm }) =>
          rm(directory, { recursive: true, force: true }),
        ),
      ),
  );
});

function image(red: number): Buffer {
  const png = new PNG({ width: 1, height: 1 });
  png.data.set([red, 0, 0, 255]);
  return PNG.sync.write(png);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function metadata(value: Buffer): BaselineMetadata {
  return {
    schemaVersion: 1,
    baselineSha256: sha256(value),
    browser: {
      name: "chromium",
      version: "136.0.0",
      playwrightVersion: "1.53.2",
    },
    platform: "linux",
    viewport: { width: 1, height: 1 },
    deviceScaleFactor: 1,
    comparator: { name: "pixelmatch", threshold: 0.1, includeAA: false },
  };
}

async function fixture() {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "visual-approval-"));
  temporaryDirectories.push(artifactRoot);
  const directory = path.join(artifactRoot, "story", "chromium");
  await mkdir(directory, { recursive: true });
  const baseline = image(10);
  const candidate = image(20);
  const baselinePath = path.join(directory, "baseline.png");
  const baselineMetadataPath = path.join(directory, "baseline.json");
  const candidatePath = path.join(directory, "candidate.png");
  await writeFile(baselinePath, baseline);
  await writeFile(baselineMetadataPath, JSON.stringify(metadata(baseline)));
  await writeFile(candidatePath, candidate);

  const result: CompletedVisualResult = {
    completed: true,
    runId: "run-1",
    storyId: "button--primary",
    importPath: "./src/button.stories.tsx",
    environmentKey: "chromium",
    status: "changed",
    candidateSha256: sha256(candidate),
    candidateMetadata: metadata(candidate),
    artifactRoot,
    candidatePath,
    baselinePath,
    baselineMetadataPath,
  };
  const request: ApprovalRequest = {
    runId: result.runId,
    storyId: result.storyId,
    environmentKey: result.environmentKey,
    candidateSha256: result.candidateSha256,
  };
  return { baseline, candidate, request, result };
}

describe("approveCandidate", () => {
  test("promotes the reviewed candidate bytes and matching metadata", async () => {
    const { candidate, request, result } = await fixture();

    const approved = await approveCandidate({
      request,
      result,
      currentImportPath: result.importPath,
    });

    expect(await readFile(result.baselinePath)).toEqual(candidate);
    expect(
      JSON.parse(await readFile(result.baselineMetadataPath, "utf8")),
    ).toEqual(metadata(candidate));
    expect(approved.baselineSha256).toBe(sha256(candidate));
    expect((await readdir(path.dirname(result.baselinePath))).sort()).toEqual([
      "baseline.json",
      "baseline.png",
      "candidate.png",
    ]);
  });

  test("rejects a stale reviewed hash after the candidate changes without mutation", async () => {
    const { baseline, request, result } = await fixture();
    await writeFile(result.candidatePath, image(30));

    await expect(
      approveCandidate({
        request,
        result,
        currentImportPath: result.importPath,
      }),
    ).rejects.toThrow(/stale/i);

    expect(await readFile(result.baselinePath)).toEqual(baseline);
  });

  test.each([
    ["runId", { runId: "run-2" }, undefined],
    ["storyId", { storyId: "other--story" }, undefined],
    ["environmentKey", { environmentKey: "firefox" }, undefined],
    ["candidateSha256", { candidateSha256: "a".repeat(64) }, undefined],
    ["importPath", {}, "./src/other.stories.tsx"],
  ])("fails closed on a mismatched %s", async (_name, patch, importPath) => {
    const { baseline, request, result } = await fixture();

    await expect(
      approveCandidate({
        request: { ...request, ...patch },
        result,
        currentImportPath: importPath ?? result.importPath,
      }),
    ).rejects.toThrow(/stale/i);

    expect(await readFile(result.baselinePath)).toEqual(baseline);
    expect(
      JSON.parse(await readFile(result.baselineMetadataPath, "utf8")),
    ).toEqual(metadata(baseline));
  });
});
