import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { StoryIndex } from "storybook/internal/types";
import { describe, expect, test, vi } from "vitest";

import { DEFAULT_ENVIRONMENT } from "../src/constants.js";
import { VisualTestRunner } from "../src/node/runner.js";

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
        capture: vi.fn(async ({ storyId, candidatePath, signal }) => {
          active += 1;
          peak = Math.max(peak, active);
          captured.push(storyId);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          if (signal?.aborted) return { status: "cancelled" as const };
          const image = Buffer.from(storyId);
          await mkdir(path.dirname(candidatePath), { recursive: true });
          await writeFile(candidatePath, image);
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

  test("a newer run cancels and cannot be overwritten by a superseded run", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const states: string[] = [];
    const runner = minimalRunner({
      captured: [],
      onState: (state) => states.push(state.runId ?? "none"),
      capture: async ({ storyId, candidatePath, signal }) => {
        if (storyId === "alpha--one") await firstBlocked;
        if (signal?.aborted) return { status: "cancelled" as const };
        await mkdir(path.dirname(candidatePath), { recursive: true });
        const image = Buffer.from(storyId);
        await writeFile(candidatePath, image);
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
  resolveArtifactPaths?: ConstructorParameters<
    typeof VisualTestRunner
  >[0]["resolveArtifactPaths"];
}) {
  const root = path.join(process.cwd(), "test/.tmp/runner-minimal");
  return new VisualTestRunner({
    baseUrl: "http://127.0.0.1:6006",
    cwd: process.cwd(),
    storyRoots: ["packages/ui/src"],
    storyIndexGenerator: fakeStoryIndex(),
    onState: options.onState,
    resolveArtifactPaths:
      options.resolveArtifactPaths ??
      (async ({ storyId }) => pathsFor(root, storyId)),
    createCaptureSession: async () => ({
      close: vi.fn(async () => undefined),
      capture:
        options.capture ??
        (async ({ storyId, candidatePath }) => {
          options.captured.push(storyId);
          await mkdir(path.dirname(candidatePath), { recursive: true });
          const image = Buffer.from(storyId);
          await writeFile(candidatePath, image);
          return {
            status: "captured" as const,
            image,
            browserVersion: "136.0",
            playwrightVersion: "1.53.2",
          };
        }),
    }),
    comparePngs: () => ({
      status: "new",
      candidateSha256: "a".repeat(64),
      diffPixels: 0,
      diffRatio: 0,
      width: 1280,
      height: 720,
    }),
    approveCandidate: options.approveCandidate as never,
  });
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
    resultPath: path.join(directory, "result.json"),
  };
}
