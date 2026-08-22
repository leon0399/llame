import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { loadWorkspaceManifest } from "./workspace-manifest.js";

describe("Workspace manifest", () => {
  const cleanup: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanup
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test("loads explicit paths and policies without discovering directories", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-workspaces-"));
    cleanup.push(directory);
    const manifestPath = join(directory, "workspaces.json");
    await writeFile(
      manifestPath,
      JSON.stringify([
        {
          id: "llame",
          label: "llame",
          rootPath: "/srv/workspaces/llame",
          entryPolicy: "ask",
          recoveryPolicy: "wait",
        },
      ]),
    );

    await expect(loadWorkspaceManifest(manifestPath)).resolves.toEqual([
      {
        id: "llame",
        label: "llame",
        rootPath: "/srv/workspaces/llame",
        entryPolicy: "ask",
        recoveryPolicy: "wait",
      },
    ]);
  });
});
