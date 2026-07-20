import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

import type { BaselineMetadata } from "../shared/results.js";
import { parseBaselineMetadata, sha256 } from "./compare.js";
import { assertPathConfined } from "./paths.js";

export interface ApprovalRequest {
  runId: string;
  storyId: string;
  environmentKey: string;
  candidateSha256: string;
}

export interface CompletedVisualResult {
  completed: true;
  runId: string;
  storyId: string;
  importPath: string;
  environmentKey: string;
  status: "new" | "changed";
  candidateSha256: string;
  candidateMetadata: BaselineMetadata;
  artifactRoot: string;
  candidatePath: string;
  baselinePath: string;
  baselineMetadataPath: string;
}

export async function approveCandidate(options: {
  request: ApprovalRequest;
  result: CompletedVisualResult;
  currentImportPath: string;
}): Promise<BaselineMetadata> {
  const { request, result } = options;
  if (
    result.completed !== true ||
    (result.status !== "new" && result.status !== "changed") ||
    request.runId !== result.runId ||
    request.storyId !== result.storyId ||
    request.environmentKey !== result.environmentKey ||
    request.candidateSha256 !== result.candidateSha256 ||
    options.currentImportPath !== result.importPath
  ) {
    throw staleApproval();
  }

  const metadata = parseBaselineMetadata(result.candidateMetadata);
  if (!metadata || metadata.baselineSha256 !== result.candidateSha256) {
    throw staleApproval();
  }

  assertArtifactFileLayout(result);
  await Promise.all([
    assertPathConfined(result.artifactRoot, result.candidatePath),
    assertPathConfined(result.artifactRoot, result.baselinePath),
    assertPathConfined(result.artifactRoot, result.baselineMetadataPath),
  ]);

  const candidate = await readFile(result.candidatePath);
  if (sha256(candidate) !== request.candidateSha256) throw staleApproval();

  await mkdir(path.dirname(result.baselinePath), { recursive: true });
  await writeAtomically(result.baselinePath, candidate);
  await writeAtomically(
    result.baselineMetadataPath,
    Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`),
  );
  return metadata;
}

function assertArtifactFileLayout(result: CompletedVisualResult): void {
  const directory = path.dirname(result.candidatePath);
  if (
    path.basename(result.candidatePath) !== "candidate.png" ||
    path.dirname(result.baselinePath) !== directory ||
    path.basename(result.baselinePath) !== "baseline.png" ||
    path.dirname(result.baselineMetadataPath) !== directory ||
    path.basename(result.baselineMetadataPath) !== "baseline.json"
  ) {
    throw staleApproval();
  }
}

async function writeAtomically(
  destination: string,
  value: Buffer,
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(value);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, destination);

    const directory = await open(path.dirname(destination), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function staleApproval(): Error {
  return new Error(
    "Stale visual approval; rerun the visual test before approving",
  );
}
