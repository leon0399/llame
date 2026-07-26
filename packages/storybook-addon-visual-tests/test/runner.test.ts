import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PNG } from "pngjs";
import type { StoryIndex } from "storybook/internal/types";
import { describe, expect, test, vi } from "vitest";

import { DEFAULT_ENVIRONMENT } from "../src/constants.js";
import {
  COMPARATOR_POLICY,
  comparePngs,
  sha256,
  type ComparisonResult,
} from "../src/node/compare.js";
import { VisualTestRunner } from "../src/node/runner.js";
import { ArtifactRegistry } from "../src/node/server.js";

describe("VisualTestRunner", () => {
  test("discovers exact live story entries and runs at most two captures concurrently", async () => {
    const root = path.join(process.cwd(), "test/.tmp/runner-concurrency");
    let active = 0;
    let peak = 0;
    const captured: string[] = [];
    const stateStatuses: string[][] = [];
    const runner = new VisualTestRunner({
      baseUrl: "http://127.0.0.1:6006",
      cwd: process.cwd(),
      storyRoots: ["packages/ui/src"],
      storyIndexGenerator: fakeStoryIndex(),
      onState: (state) =>
        stateStatuses.push(state.results.map((result) => result.status)),
      resolveArtifactPaths: async ({ storyId }) => pathsFor(root, storyId),
      createCaptureSession: async () => ({
        close: vi.fn(async () => undefined),
        capture: vi.fn(async ({ storyId, signal }) => {
          active += 1;
          peak = Math.max(peak, active);
          captured.push(storyId);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          if (signal?.aborted) return { status: "cancelled" as const };
          const image = Buffer.from(storyId);
          return {
            status: "captured" as const,
            image,
            browserVersion: "136.0",
            playwrightVersion: "1.53.2",
          };
        }),
      }),
      comparePngs: () => ({
        status: "new" as const,
        candidateSha256: "a".repeat(64),
        diffPixels: 0,
        diffRatio: 0,
        width: 1280,
        height: 720,
      }),
    });

    const state = await runner.run({ scope: "all" });

    expect(peak).toBe(2);
    expect(captured).toEqual(["alpha--one", "beta--two", "gamma--three"]);
    expect(state.results).toMatchObject([
      {
        storyId: "alpha--one",
        title: "Alpha / One",
        importPath: "packages/ui/src/alpha.stories.tsx",
        status: "new",
      },
      {
        storyId: "beta--two",
        importPath: "packages/ui/src/beta.stories.tsx",
        status: "new",
      },
      { storyId: "gamma--three", status: "new" },
    ]);
    expect(stateStatuses[0]).toEqual(["queued", "queued", "queued"]);
    expect(stateStatuses.some((statuses) => statuses.includes("running"))).toBe(
      true,
    );
  });

  test("current scope resolves only the exact Storybook ID", async () => {
    const captured: string[] = [];
    const runner = minimalRunner({ captured });

    const state = await runner.run({ scope: "current", storyId: "beta--two" });

    expect(captured).toEqual(["beta--two"]);
    expect(state.results).toHaveLength(1);
    expect(state.results[0]?.storyId).toBe("beta--two");
    await expect(
      runner.run({ scope: "current", storyId: "made-up--id" }),
    ).rejects.toThrow("Unknown Storybook story ID");
  });

  test("preserves the underlying capture-stage error", async () => {
    const runner = minimalRunner({
      captured: [],
      resolveArtifactPaths: async () => {
        throw new Error("Story root does not exist: packages/ui/src");
      },
    });

    const state = await runner.run({
      scope: "current",
      storyId: "alpha--one",
    });

    expect(state.results[0]).toMatchObject({
      status: "capture-error",
      message:
        "Visual capture failed: Story root does not exist: packages/ui/src",
    });
  });

  test("skips disabled stories before resolving source-adjacent paths", async () => {
    const resolveArtifactPaths = vi.fn(async () => {
      throw new Error("disabled story is outside configured roots");
    });
    const runner = minimalRunner({
      captured: [],
      resolveArtifactPaths,
      capture: async () => ({ status: "disabled" as const }),
    });

    const state = await runner.run({
      scope: "current",
      storyId: "alpha--one",
    });

    expect(resolveArtifactPaths).not.toHaveBeenCalled();
    expect(state.results[0]).toMatchObject({
      status: "passed",
      message: "Visual tests disabled for this story",
    });
  });

  test("a later run request wins when story discovery resolves out of order", async () => {
    const pending: Array<() => void> = [];
    const baseIndex = fakeStoryIndex();
    const storyIndexGenerator = {
      getIndex: vi.fn(
        () =>
          new Promise<Awaited<ReturnType<typeof baseIndex.getIndex>>>(
            (resolve) => {
              pending.push(async () => resolve(await baseIndex.getIndex()));
            },
          ),
      ),
    };
    const captured: string[] = [];
    const runner = minimalRunner({ captured, storyIndexGenerator });

    const first = runner.run({ scope: "current", storyId: "alpha--one" });
    const second = runner.run({ scope: "current", storyId: "beta--two" });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!();
    await vi.waitFor(() => expect(captured).toEqual(["beta--two"]));
    pending[0]!();

    const secondState = await second;
    await first;
    expect(captured).toEqual(["beta--two"]);
    expect(runner.getState()).toEqual(secondState);
  });

  test("a newer run cancels and cannot be overwritten by a superseded run", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const states: string[] = [];
    const runner = minimalRunner({
      captured: [],
      onState: (state) => states.push(state.runId ?? "none"),
      capture: async ({ storyId, signal }) => {
        if (storyId === "alpha--one") await firstBlocked;
        if (signal?.aborted) return { status: "cancelled" as const };
        const image = Buffer.from(storyId);
        return {
          status: "captured" as const,
          image,
          browserVersion: "136.0",
          playwrightVersion: "1.53.2",
        };
      },
    });

    const first = runner.run({ scope: "current", storyId: "alpha--one" });
    await vi.waitFor(() => expect(runner.getState().running).toBe(true));
    const second = runner.run({ scope: "current", storyId: "beta--two" });
    releaseFirst();
    const secondState = await second;
    await first;

    expect(secondState.results[0]).toMatchObject({
      storyId: "beta--two",
      status: "new",
    });
    expect(runner.getState()).toEqual(secondState);
    expect(states.at(-1)).toBe(secondState.runId);
  });

  test("keeps prior results and approvals when a later run targets one story", async () => {
    const captured: string[] = [];
    const approveCandidate = vi.fn(async (_options: unknown) => ({
      baselineSha256: "a".repeat(64),
    }));
    const runner = minimalRunner({ captured, approveCandidate });

    await runner.run({ scope: "all" });
    expect(captured).toEqual(["alpha--one", "beta--two", "gamma--three"]);

    captured.length = 0;
    const state = await runner.run({ scope: "current", storyId: "beta--two" });

    // Only beta is recaptured, but every earlier result survives.
    expect(captured).toEqual(["beta--two"]);
    expect(state.results.map((result) => result.storyId).sort()).toEqual([
      "alpha--one",
      "beta--two",
      "gamma--three",
    ]);

    // A story from the earlier run stays approvable via its own run's identity.
    const alpha = state.results.find((r) => r.storyId === "alpha--one")!;
    await runner.approve({
      runId: alpha.runId,
      storyId: "alpha--one",
      environmentKey: DEFAULT_ENVIRONMENT.key,
      candidateSha256: "a".repeat(64),
    });
    expect(approveCandidate).toHaveBeenCalledTimes(1);
    expect(
      runner.getState().results.find((r) => r.storyId === "alpha--one")?.status,
    ).toBe("passed");
  });

  test("cancellation invalidates completed results from the active run", async () => {
    let releaseBlockedCapture!: () => void;
    const blockedCapture = new Promise<void>((resolve) => {
      releaseBlockedCapture = resolve;
    });
    const approveCandidate = vi.fn(async (_options: unknown) => ({
      baselineSha256: "a".repeat(64),
    }));
    let cancelled = false;
    let runner!: VisualTestRunner;
    runner = minimalRunner({
      captured: [],
      approveCandidate,
      capture: async ({ storyId, signal }) => {
        if (storyId !== "alpha--one") await blockedCapture;
        if (signal?.aborted) return { status: "cancelled" as const };
        return {
          status: "captured" as const,
          image: Buffer.from(storyId),
          browserVersion: "136.0",
          playwrightVersion: "1.53.2",
        };
      },
      onState: (state) => {
        if (
          !cancelled &&
          state.running &&
          state.results.some(
            ({ storyId, status }) =>
              storyId === "alpha--one" && status === "new",
          )
        ) {
          cancelled = true;
          runner.cancel();
          releaseBlockedCapture();
        }
      },
    });

    const state = await runner.run({ scope: "all" });
    const alpha = state.results.find(
      ({ storyId }) => storyId === "alpha--one",
    )!;

    expect(cancelled).toBe(true);
    expect(state.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          storyId: "alpha--one",
          status: "cancelled",
        }),
        expect.objectContaining({
          storyId: "beta--two",
          status: "cancelled",
        }),
        expect.objectContaining({
          storyId: "gamma--three",
          status: "cancelled",
        }),
      ]),
    );
    await expect(
      runner.approve({
        runId: alpha.runId,
        storyId: alpha.storyId,
        environmentKey: alpha.environmentKey,
        candidateSha256: alpha.candidateSha256!,
      }),
    ).rejects.toThrow("Stale visual approval");
    expect(approveCandidate).not.toHaveBeenCalled();
  });

  test("cancellation during capture post-processing cannot restore approval", async () => {
    const approveCandidate = vi.fn(async (_options: unknown) => ({
      baselineSha256: "a".repeat(64),
    }));
    let runner!: VisualTestRunner;
    let cancelled = false;
    runner = minimalRunner({
      captured: [],
      approveCandidate,
      artifactRegistry: {
        register: vi.fn(() => {
          if (!cancelled) {
            cancelled = true;
            runner.cancel();
          }
          return "candidate-artifact";
        }),
      },
    });

    const state = await runner.run({
      scope: "current",
      storyId: "alpha--one",
    });
    const result = state.results[0]!;

    expect(cancelled).toBe(true);
    expect(result.status).toBe("cancelled");
    await expect(
      runner.approve({
        runId: result.runId,
        storyId: result.storyId,
        environmentKey: result.environmentKey,
        candidateSha256: "a".repeat(64),
      }),
    ).rejects.toThrow("Stale visual approval");
    expect(approveCandidate).not.toHaveBeenCalled();
  });

  test("approves only the exact completed candidate without recapturing", async () => {
    const approveCandidate = vi.fn(async (_options: unknown) => ({
      baselineSha256: "a".repeat(64),
    }));
    const runner = minimalRunner({ captured: [], approveCandidate });
    const state = await runner.run({ scope: "current", storyId: "alpha--one" });
    const runId = state.runId!;

    await runner.approve({
      runId,
      storyId: "alpha--one",
      environmentKey: DEFAULT_ENVIRONMENT.key,
      candidateSha256: "a".repeat(64),
    });

    expect(approveCandidate).toHaveBeenCalledTimes(1);
    expect(approveCandidate.mock.calls[0]?.[0]).toMatchObject({
      request: { runId, storyId: "alpha--one" },
      currentImportPath: "packages/ui/src/alpha.stories.tsx",
      result: { completed: true, candidateSha256: "a".repeat(64) },
    });
    expect(runner.getState().results[0]?.status).toBe("passed");
    await expect(
      runner.approve({
        runId,
        storyId: "alpha--one",
        environmentKey: DEFAULT_ENVIRONMENT.key,
        candidateSha256: "b".repeat(64),
      }),
    ).rejects.toThrow("Stale visual approval");
  });

  test("a corrupt baseline.json does not crash the story run", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "visual-corrupt-"));
    try {
      const paths = pathsFor(dir, "alpha--one");
      await mkdir(paths.directory, { recursive: true });
      await writeFile(paths.baselinePath, Buffer.from("baseline-png"));
      await writeFile(paths.baselineMetadataPath, "{ not valid json");

      const runner = minimalRunner({
        captured: [],
        resolveArtifactPaths: async ({ storyId }) => pathsFor(dir, storyId),
      });
      const state = await runner.run({
        scope: "current",
        storyId: "alpha--one",
      });

      // Old behaviour threw in JSON.parse and surfaced a capture-error.
      expect(state.results[0]).toMatchObject({ status: "new" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("keeps a passing result when the stale diff cannot be removed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "visual-undeletable-"));
    try {
      const paths = pathsFor(dir, "alpha--one");
      await mkdir(paths.directory, { recursive: true });
      await writeFile(paths.baselinePath, Buffer.from("baseline-png"));
      // A directory at diff.png makes the non-recursive removal fail with
      // something other than ENOENT, standing in for the real-world cases
      // (locked file, read-only mount, permission drift) that `force` does
      // not suppress.
      await mkdir(paths.diffPath, { recursive: true });

      const registered: string[] = [];
      const runner = minimalRunner({
        captured: [],
        resolveArtifactPaths: async ({ storyId }) => pathsFor(dir, storyId),
        artifactRegistry: { register: registerByBasename(registered) },
        comparePngs: () => passedComparison(),
      });

      const state = await runner.run({
        scope: "current",
        storyId: "alpha--one",
      });

      // Cleanup is best effort: failing to unlink must not turn a genuinely
      // passing comparison into a capture-error, which the testing widget
      // would report as a failed visual test.
      expect(state.results[0]).toMatchObject({ status: "passed" });
      expect(state.results[0]?.message).toBeUndefined();
      // The exposure invariant does not depend on the removal succeeding.
      expect(state.results[0]?.artifacts?.diff).toBeUndefined();
      expect(registered).not.toContain(paths.diffPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("kills an earlier run's diff id against the real artifact registry", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "visual-registry-"));
    try {
      const paths = pathsFor(dir, "alpha--one");
      await mkdir(paths.directory, { recursive: true });
      await writeFile(paths.baselinePath, Buffer.from("baseline-png"));

      // The real registry, not a stub — this test exists because the whole
      // reason removal beats non-registration is a registry implementation
      // detail, so stubbing it would assume away the thing under test.
      const registry = new ArtifactRegistry();
      let comparison: ComparisonResult = changedComparison(
        Buffer.from("diff-png"),
      );
      const runner = minimalRunner({
        captured: [],
        resolveArtifactPaths: async ({ storyId }) => pathsFor(dir, storyId),
        artifactRegistry: registry,
        comparePngs: () => comparison,
      });

      const changed = await runner.run({
        scope: "current",
        storyId: "alpha--one",
      });
      const leakedId = changed.results[0]!.artifacts!.diff!;
      expect(registry.resolve(leakedId)).toBe(paths.diffPath);

      comparison = passedComparison();
      const passed = await runner.run({
        scope: "current",
        storyId: "alpha--one",
      });

      expect(passed.results[0]?.artifacts?.diff).toBeUndefined();
      // The id itself is immortal: the registry hands out one per path for the
      // process lifetime, so it still maps to the same path afterwards.
      expect(registry.resolve(leakedId)).toBe(paths.diffPath);
      // Removing the bytes is therefore what actually retires it — the
      // artifact route reads the path and 404s once this read fails.
      await expect(readFile(registry.resolve(leakedId)!)).rejects.toMatchObject(
        { code: "ENOENT" },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("registers a diff for changed pixels, then deletes it when a later run passes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "visual-diff-"));
    try {
      const paths = pathsFor(dir, "alpha--one");
      await mkdir(paths.directory, { recursive: true });
      await writeFile(paths.baselinePath, Buffer.from("baseline-png"));

      const registered: string[] = [];
      let comparison: ComparisonResult = changedComparison(
        Buffer.from("diff-png"),
      );
      const runner = minimalRunner({
        captured: [],
        resolveArtifactPaths: async ({ storyId }) => pathsFor(dir, storyId),
        artifactRegistry: { register: registerByBasename(registered) },
        comparePngs: () => comparison,
      });

      const changed = await runner.run({
        scope: "current",
        storyId: "alpha--one",
      });

      expect(changed.results[0]).toMatchObject({ status: "changed" });
      expect(changed.results[0]?.artifacts).toEqual({
        baseline: "id:baseline.png",
        candidate: "id:candidate.png",
        diff: "id:diff.png",
      });
      await expect(readFile(paths.diffPath)).resolves.toEqual(
        Buffer.from("diff-png"),
      );

      registered.length = 0;
      comparison = passedComparison();
      const passed = await runner.run({
        scope: "current",
        storyId: "alpha--one",
      });

      expect(passed.results[0]).toMatchObject({ status: "passed" });
      expect(passed.results[0]?.artifacts).toEqual({
        baseline: "id:baseline.png",
        candidate: "id:candidate.png",
      });
      expect(registered).not.toContain(paths.diffPath);
      // The stale file is removed, not merely omitted: the registry keeps an
      // opaque id alive per path for the process lifetime, so leaving the
      // bytes on disk would keep the earlier run's diff servable.
      await expect(readFile(paths.diffPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("keeps a metadata-only change reviewable and approvable without a diff", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "visual-metadata-"));
    try {
      const paths = pathsFor(dir, "alpha--one");
      await mkdir(paths.directory, { recursive: true });
      await writeFile(paths.baselinePath, Buffer.from("baseline-png"));

      const registered: string[] = [];
      const approveCandidate = vi.fn(async (_options: unknown) => ({
        baselineSha256: "a".repeat(64),
      }));
      const runner = minimalRunner({
        captured: [],
        approveCandidate,
        resolveArtifactPaths: async ({ storyId }) => pathsFor(dir, storyId),
        artifactRegistry: { register: registerByBasename(registered) },
        comparePngs: () => ({
          ...passedComparison(),
          status: "changed" as const,
          message: "Baseline environment metadata is incompatible",
        }),
      });

      const state = await runner.run({
        scope: "current",
        storyId: "alpha--one",
      });

      expect(state.results[0]).toMatchObject({
        status: "changed",
        message: "Baseline environment metadata is incompatible",
        diffPixels: 0,
      });
      expect(state.results[0]?.artifacts).toEqual({
        baseline: "id:baseline.png",
        candidate: "id:candidate.png",
      });
      await expect(readFile(paths.diffPath)).rejects.toMatchObject({
        code: "ENOENT",
      });

      // Zero changed pixels must not cost the reviewer their approval path.
      await runner.approve({
        runId: state.runId!,
        storyId: "alpha--one",
        environmentKey: DEFAULT_ENVIRONMENT.key,
        candidateSha256: "a".repeat(64),
      });
      expect(approveCandidate).toHaveBeenCalledTimes(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // The tests above inject a fake comparator to drive the artifact wiring.
  // These two run the real one end to end, so the disk-level invariant is not
  // only asserted against a mock.
  test.each([
    [
      "a real passing comparison",
      "136.0",
      { status: "passed", message: undefined },
    ],
    [
      "a real metadata-only incompatibility",
      "999.0",
      {
        status: "changed",
        message:
          "Baseline environment metadata is incompatible with the candidate",
      },
    ],
  ])(
    "leaves no diff on disk or in the result for %s",
    async (_name, baselineBrowserVersion, expected) => {
      const dir = await mkdtemp(path.join(tmpdir(), "visual-real-"));
      try {
        const paths = pathsFor(dir, "alpha--one");
        await mkdir(paths.directory, { recursive: true });

        // Byte-identical baseline and candidate: zero changed pixels.
        const image = realPng();
        await writeFile(paths.baselinePath, image);
        await writeFile(
          paths.baselineMetadataPath,
          JSON.stringify(
            baselineMetadataFor(image, {
              browserVersion: baselineBrowserVersion,
            }),
          ),
        );
        // A diff left behind by an earlier changed run.
        await writeFile(paths.diffPath, Buffer.from("stale-diff-png"));

        const registered: string[] = [];
        const runner = minimalRunner({
          captured: [],
          resolveArtifactPaths: async ({ storyId }) => pathsFor(dir, storyId),
          artifactRegistry: { register: registerByBasename(registered) },
          comparePngs: comparePngs,
          capture: async () => ({
            status: "captured" as const,
            image,
            browserVersion: "136.0",
            playwrightVersion: "1.53.2",
          }),
        });

        const state = await runner.run({
          scope: "current",
          storyId: "alpha--one",
        });

        expect(state.results[0]).toMatchObject({
          status: expected.status,
          diffPixels: 0,
        });
        expect(state.results[0]?.message).toBe(expected.message);
        expect(state.results[0]?.artifacts?.diff).toBeUndefined();
        expect(registered).not.toContain(paths.diffPath);
        await expect(readFile(paths.diffPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  test("loadBaseline surfaces a committed baseline without capturing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "visual-baseline-"));
    try {
      const registered: string[] = [];
      const paths = pathsFor(dir, "alpha--one");
      await mkdir(paths.directory, { recursive: true });
      await writeFile(paths.baselinePath, Buffer.from("baseline-png"));

      const runner = new VisualTestRunner({
        baseUrl: "http://127.0.0.1:6006",
        cwd: process.cwd(),
        storyRoots: ["packages/ui/src"],
        storyIndexGenerator: fakeStoryIndex(),
        resolveArtifactPaths: async ({ storyId }) => pathsFor(dir, storyId),
        artifactRegistry: {
          register: (filePath) => {
            registered.push(filePath);
            return "opaque-baseline";
          },
        },
      });

      await expect(runner.loadBaseline("alpha--one")).resolves.toEqual({
        storyId: "alpha--one",
        environmentKey: DEFAULT_ENVIRONMENT.key,
        artifactId: "opaque-baseline",
      });
      expect(registered).toEqual([paths.baselinePath]);

      // Known story with no baseline on disk: no artifact id.
      await expect(runner.loadBaseline("beta--two")).resolves.toEqual({
        storyId: "beta--two",
        environmentKey: DEFAULT_ENVIRONMENT.key,
      });

      // Unknown story id: resolution fails softly, never throws.
      await expect(runner.loadBaseline("made-up--id")).resolves.toEqual({
        storyId: "made-up--id",
        environmentKey: DEFAULT_ENVIRONMENT.key,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function fakeStoryIndex(): ConstructorParameters<
  typeof VisualTestRunner
>[0]["storyIndexGenerator"] {
  return {
    getIndex: vi.fn(
      async () =>
        ({
          v: 5,
          entries: {
            "alpha--one": {
              type: "story",
              subtype: "story",
              id: "alpha--one",
              title: "Alpha",
              name: "One",
              importPath: "packages/ui/src/alpha.stories.tsx",
            },
            "alpha--docs": {
              type: "docs",
              id: "alpha--docs",
              title: "Alpha",
              name: "Docs",
              importPath: "packages/ui/src/alpha.stories.tsx",
              storiesImports: [],
            },
            "beta--two": {
              type: "story",
              subtype: "story",
              id: "beta--two",
              title: "Beta",
              name: "Two",
              importPath: "packages/ui/src/beta.stories.tsx",
            },
            "gamma--three": {
              type: "story",
              subtype: "story",
              id: "gamma--three",
              title: "Gamma",
              name: "Three",
              importPath: "packages/ui/src/gamma.stories.tsx",
            },
          },
        }) as StoryIndex,
    ),
  };
}

function minimalRunner(options: {
  captured: string[];
  onState?: ConstructorParameters<typeof VisualTestRunner>[0]["onState"];
  capture?: (
    request: Parameters<
      Awaited<
        ReturnType<
          NonNullable<
            ConstructorParameters<
              typeof VisualTestRunner
            >[0]["createCaptureSession"]
          >
        >
      >["capture"]
    >[0],
  ) => Promise<
    Awaited<
      ReturnType<
        Awaited<
          ReturnType<
            NonNullable<
              ConstructorParameters<
                typeof VisualTestRunner
              >[0]["createCaptureSession"]
            >
          >
        >["capture"]
      >
    >
  >;
  approveCandidate?: (...args: any[]) => Promise<any>;
  artifactRegistry?: ConstructorParameters<
    typeof VisualTestRunner
  >[0]["artifactRegistry"];
  comparePngs?: ConstructorParameters<
    typeof VisualTestRunner
  >[0]["comparePngs"];
  resolveArtifactPaths?: ConstructorParameters<
    typeof VisualTestRunner
  >[0]["resolveArtifactPaths"];
  storyIndexGenerator?: ConstructorParameters<
    typeof VisualTestRunner
  >[0]["storyIndexGenerator"];
}) {
  const root = path.join(process.cwd(), "test/.tmp/runner-minimal");
  return new VisualTestRunner({
    baseUrl: "http://127.0.0.1:6006",
    cwd: process.cwd(),
    storyRoots: ["packages/ui/src"],
    storyIndexGenerator: options.storyIndexGenerator ?? fakeStoryIndex(),
    onState: options.onState,
    resolveArtifactPaths:
      options.resolveArtifactPaths ??
      (async ({ storyId }) => pathsFor(root, storyId)),
    createCaptureSession: async () => ({
      close: vi.fn(async () => undefined),
      capture:
        options.capture ??
        (async ({ storyId }) => {
          options.captured.push(storyId);
          const image = Buffer.from(storyId);
          return {
            status: "captured" as const,
            image,
            browserVersion: "136.0",
            playwrightVersion: "1.53.2",
          };
        }),
    }),
    artifactRegistry: options.artifactRegistry,
    comparePngs:
      options.comparePngs ??
      (() => ({
        status: "new",
        candidateSha256: "a".repeat(64),
        diffPixels: 0,
        diffRatio: 0,
        width: 1280,
        height: 720,
      })),
    approveCandidate: options.approveCandidate as never,
  });
}

function realPng(): Buffer {
  const image = new PNG({ width: 2, height: 1 });
  image.data.set([0, 0, 0, 255], 0);
  image.data.set([0, 0, 0, 255], 4);
  return PNG.sync.write(image);
}

/** Shaped to satisfy the comparator's strict baseline-metadata validation. */
function baselineMetadataFor(
  image: Buffer,
  options: { browserVersion: string },
) {
  return {
    schemaVersion: 1,
    baselineSha256: sha256(image),
    browser: {
      name: DEFAULT_ENVIRONMENT.browserName,
      version: options.browserVersion,
      playwrightVersion: "1.53.2",
    },
    platform: process.platform,
    viewport: DEFAULT_ENVIRONMENT.viewport,
    deviceScaleFactor: DEFAULT_ENVIRONMENT.deviceScaleFactor,
    comparator: COMPARATOR_POLICY,
  };
}

function passedComparison() {
  return {
    status: "passed" as const,
    baselineSha256: "b".repeat(64),
    candidateSha256: "a".repeat(64),
    diffPixels: 0,
    diffRatio: 0,
    width: 2,
    height: 1,
  };
}

function changedComparison(diff: Buffer) {
  return {
    ...passedComparison(),
    status: "changed" as const,
    diff,
    diffPixels: 1,
    diffRatio: 0.5,
  };
}

/** Mirrors the real registry's stable path-to-id mapping, but readably. */
function registerByBasename(registered: string[]) {
  return (filePath: string) => {
    registered.push(filePath);
    return `id:${path.basename(filePath)}`;
  };
}

function pathsFor(root: string, storyId: string) {
  const directory = path.join(root, storyId);
  return {
    artifactRoot: root,
    storyPath: path.join(root, `${storyId}.stories.tsx`),
    directory,
    baselinePath: path.join(directory, "baseline.png"),
    baselineMetadataPath: path.join(directory, "baseline.json"),
    candidatePath: path.join(directory, "candidate.png"),
    diffPath: path.join(directory, "diff.png"),
  };
}
