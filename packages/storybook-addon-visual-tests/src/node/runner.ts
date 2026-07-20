import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_ENVIRONMENT } from "../constants.js";
import type { VisualResult, VisualRunState } from "../shared/results.js";
import {
  approveCandidate as approveCandidateDefault,
  type ApprovalRequest,
  type CompletedVisualResult,
} from "./approval.js";
import {
  COMPARATOR_POLICY,
  comparePngs as comparePngsDefault,
  sha256,
} from "./compare.js";
import {
  createChromiumCaptureSession,
  type CaptureResult,
  type ChromiumCaptureSession,
} from "./capture.js";
import {
  resolveArtifactPaths as resolveArtifactPathsDefault,
  type ArtifactPaths,
  type ResolveArtifactPathsOptions,
} from "./paths.js";
import {
  discoverStories,
  type StoryIndexGenerator,
  type StorySelection,
} from "./story-index.js";

type ComparePngs = typeof comparePngsDefault;
type ApproveCandidate = typeof approveCandidateDefault;

interface ArtifactRegistrar {
  register(filePath: string): string;
}

export interface VisualTestRunnerOptions {
  baseUrl: string;
  cwd: string;
  storyRoots: string[];
  storyIndexGenerator: StoryIndexGenerator;
  maxConcurrency?: number;
  onState?: (state: VisualRunState) => void;
  artifactRegistry?: ArtifactRegistrar;
  createCaptureSession?: () => Promise<ChromiumCaptureSession>;
  resolveArtifactPaths?: (
    options: ResolveArtifactPathsOptions,
  ) => Promise<ArtifactPaths>;
  comparePngs?: ComparePngs;
  approveCandidate?: ApproveCandidate;
}

interface ActiveRun {
  id: string;
  controller: AbortController;
  state: VisualRunState;
}

export class VisualTestRunner {
  private state: VisualRunState = { running: false, results: [] };
  private activeRun: ActiveRun | undefined;
  private onState: ((state: VisualRunState) => void) | undefined;
  private readonly completed = new Map<string, CompletedVisualResult>();
  private readonly createCaptureSession: () => Promise<ChromiumCaptureSession>;
  private readonly resolveArtifactPaths: VisualTestRunnerOptions["resolveArtifactPaths"];
  private readonly comparePngs: ComparePngs;
  private readonly approveCandidate: ApproveCandidate;

  constructor(private readonly options: VisualTestRunnerOptions) {
    this.onState = options.onState;
    this.createCaptureSession =
      options.createCaptureSession ?? createChromiumCaptureSession;
    this.resolveArtifactPaths =
      options.resolveArtifactPaths ?? resolveArtifactPathsDefault;
    this.comparePngs = options.comparePngs ?? comparePngsDefault;
    this.approveCandidate = options.approveCandidate ?? approveCandidateDefault;
  }

  setOnState(listener: (state: VisualRunState) => void): void {
    this.onState = listener;
  }

  getState(): VisualRunState {
    return structuredClone(this.state);
  }

  async run(selection: StorySelection): Promise<VisualRunState> {
    this.cancel();
    const stories = await discoverStories(
      this.options.storyIndexGenerator,
      selection,
    );
    const runId = randomUUID();
    const run: ActiveRun = {
      id: runId,
      controller: new AbortController(),
      state: {
        runId,
        running: true,
        results: stories.map((story) => ({
          runId,
          storyId: story.id,
          title: `${story.title} / ${story.name}`,
          importPath: story.importPath,
          environmentKey: DEFAULT_ENVIRONMENT.key,
          status: "queued",
        })),
      },
    };
    this.activeRun = run;
    this.state = run.state;
    this.publish(run);

    let session: ChromiumCaptureSession;
    try {
      session = await this.createCaptureSession();
    } catch {
      for (const result of run.state.results) {
        result.status = "capture-error";
        result.message = "Chromium could not start";
      }
      run.state.running = false;
      this.publish(run);
      return structuredClone(run.state);
    }

    try {
      await this.runPool(run, session);
    } finally {
      await session.close().catch(() => undefined);
      run.state.running = false;
      this.publish(run);
    }
    return structuredClone(run.state);
  }

  cancel(): void {
    const run = this.activeRun;
    if (!run || !run.state.running) return;
    run.controller.abort();
    for (const result of run.state.results) {
      if (result.status === "queued" || result.status === "running") {
        result.status = "cancelled";
      }
    }
    run.state.running = false;
    this.publish(run);
  }

  async approve(request: ApprovalRequest): Promise<void> {
    const result = this.completed.get(completedKey(request));
    if (!result || result.candidateSha256 !== request.candidateSha256) {
      throw staleApproval();
    }
    const stories = await discoverStories(this.options.storyIndexGenerator, {
      scope: "current",
      storyId: request.storyId,
    });
    await this.approveCandidate({
      request,
      result,
      currentImportPath: stories[0]!.importPath,
    });
    this.completed.delete(completedKey(request));

    if (this.state.runId === request.runId) {
      const publicResult = this.state.results.find(
        (item) => item.storyId === request.storyId,
      );
      if (publicResult) {
        publicResult.status = "passed";
        publicResult.message = "Approved exact captured candidate";
        this.onState?.(this.getState());
      }
    }
  }

  private async runPool(
    run: ActiveRun,
    session: ChromiumCaptureSession,
  ): Promise<void> {
    let cursor = 0;
    const worker = async () => {
      while (cursor < run.state.results.length) {
        const index = cursor;
        cursor += 1;
        const result = run.state.results[index]!;
        if (run.controller.signal.aborted) {
          result.status = "cancelled";
          continue;
        }
        await this.runStory(run, result, session);
      }
    };
    const count = Math.min(
      this.options.maxConcurrency ?? 2,
      run.state.results.length,
    );
    await Promise.all(Array.from({ length: count }, worker));
  }

  private async runStory(
    run: ActiveRun,
    result: VisualResult,
    session: ChromiumCaptureSession,
  ): Promise<void> {
    result.status = "running";
    this.publish(run);

    try {
      const paths = await this.resolveArtifactPaths!({
        cwd: this.options.cwd,
        storyRoots: this.options.storyRoots,
        importPath: result.importPath,
        storyId: result.storyId,
        environmentKey: result.environmentKey,
      });
      const capture = await session.capture({
        baseUrl: this.options.baseUrl,
        storyId: result.storyId,
        candidatePath: paths.candidatePath,
        signal: run.controller.signal,
      });
      await this.finishCapture(run, result, paths, capture);
    } catch (error) {
      result.status = run.controller.signal.aborted
        ? "cancelled"
        : "capture-error";
      result.message =
        result.status === "cancelled"
          ? undefined
          : `Visual capture failed: ${errorMessage(error)}`;
    }
    this.publish(run);
  }

  private async finishCapture(
    run: ActiveRun,
    result: VisualResult,
    paths: ArtifactPaths,
    capture: CaptureResult,
  ): Promise<void> {
    if (capture.status === "cancelled" || run.controller.signal.aborted) {
      result.status = "cancelled";
      return;
    }
    if (capture.status === "disabled") {
      result.status = "passed";
      result.message = "Visual tests disabled for this story";
      return;
    }
    if (capture.status === "capture-error") {
      result.status = "capture-error";
      result.message = capture.message;
      return;
    }

    const candidateSha256 = sha256(capture.image);
    const candidateMetadata = {
      schemaVersion: 1 as const,
      baselineSha256: candidateSha256,
      browser: {
        name: DEFAULT_ENVIRONMENT.browserName,
        version: capture.browserVersion,
        playwrightVersion: capture.playwrightVersion ?? "unknown",
      },
      platform: process.platform,
      viewport: DEFAULT_ENVIRONMENT.viewport,
      deviceScaleFactor: DEFAULT_ENVIRONMENT.deviceScaleFactor,
      comparator: COMPARATOR_POLICY,
    };
    const baseline = await readFileIfPresent(paths.baselinePath);
    const baselineMetadata = await readJsonIfPresent(
      paths.baselineMetadataPath,
    );
    const comparison = this.comparePngs({
      baseline,
      baselineMetadata,
      candidate: capture.image,
      candidateMetadata,
    });
    result.status = comparison.status;
    result.message = comparison.message;
    result.diffPixels = comparison.diffPixels;
    result.diffRatio = comparison.diffRatio;
    result.candidateSha256 = comparison.candidateSha256;

    if (comparison.diff) {
      await mkdir(path.dirname(paths.diffPath), { recursive: true });
      await writeFile(paths.diffPath, comparison.diff);
    }
    result.artifacts = {
      ...(baseline && this.options.artifactRegistry
        ? {
            baseline: this.options.artifactRegistry.register(
              paths.baselinePath,
            ),
          }
        : {}),
      ...(this.options.artifactRegistry
        ? {
            candidate: this.options.artifactRegistry.register(
              paths.candidatePath,
            ),
          }
        : {}),
      ...(comparison.diff && this.options.artifactRegistry
        ? { diff: this.options.artifactRegistry.register(paths.diffPath) }
        : {}),
    };

    if (comparison.status === "new" || comparison.status === "changed") {
      const completed: CompletedVisualResult = {
        completed: true,
        runId: result.runId,
        storyId: result.storyId,
        importPath: result.importPath,
        environmentKey: result.environmentKey,
        status: comparison.status,
        candidateSha256: comparison.candidateSha256,
        candidateMetadata,
        artifactRoot: paths.artifactRoot,
        candidatePath: paths.candidatePath,
        baselinePath: paths.baselinePath,
        baselineMetadataPath: paths.baselineMetadataPath,
      };
      this.completed.set(completedKey(completed), completed);
    }
  }

  private publish(run: ActiveRun): void {
    if (this.activeRun !== run) return;
    this.state = run.state;
    this.onState?.(this.getState());
  }
}

async function readFileIfPresent(
  filePath: string,
): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown> {
  const value = await readFileIfPresent(filePath);
  return value ? JSON.parse(value.toString("utf8")) : undefined;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function completedKey(identity: {
  runId: string;
  storyId: string;
  environmentKey: string;
}): string {
  return `${identity.runId}\0${identity.storyId}\0${identity.environmentKey}`;
}

function staleApproval(): Error {
  return new Error(
    "Stale visual approval; rerun the visual test before approving",
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
