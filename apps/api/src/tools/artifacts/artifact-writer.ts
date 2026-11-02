import { createHash } from 'node:crypto';

import { type TenantRunner } from '../../db/tenant-db.service';
import {
  ArtifactsRepository,
  type NewArtifactPart,
} from './artifacts-repository';
import { artifactLineCount } from './lines';
import { formatArtifactLocator, isLocatorName } from './locator';

/** One part a producer hands to the writer. */
export type ArtifactPartInput = {
  /** The stream name for `bash`; absent for a tool's single part. */
  readonly name?: string;
  readonly contentType: string;
  readonly content: Buffer;
  /** The read-time re-check record; the re-check ships with a later layer. */
  readonly findings?: unknown;
};

export type ArtifactWriteRequest = {
  readonly chatId: string;
  readonly userId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  /** Known when the producer stopped, so the row is complete at insert. */
  readonly complete: boolean;
  readonly parts: ReadonlyArray<ArtifactPartInput>;
};

export type WrittenArtifact = {
  readonly id: string;
  readonly seq: number;
  readonly locator: string;
  readonly lineCount: number;
  readonly byteSize: number;
};

/**
 * Store one tool result as an artifact (tool-result-artifacts D1). The number
 * comes from the Chat's counter in its own transaction, then the artifact and
 * every part are written in one transaction: a failed insert leaves no
 * artifact, and the call reports a failed write. A unique conflict on
 * `(chat_id, run_id, tool_call_id)` is such a failure — never a lookup of
 * another call's artifact.
 */
export async function writeToolArtifact(
  tenantDb: TenantRunner,
  request: ArtifactWriteRequest,
  options: { readonly maxBytes: number },
): Promise<WrittenArtifact> {
  if (!isLocatorName(request.toolName)) {
    throw new Error(`"${request.toolName}" is not a usable artifact tool name`);
  }
  const parts = request.parts.map((part) =>
    preparePart(part, options.maxBytes),
  );

  const seq = await tenantDb.runAs(request.userId, (db) =>
    new ArtifactsRepository(db).nextSeq(request.chatId, request.userId),
  );
  if (seq === undefined) {
    throw new Error('The Chat cannot store an artifact.');
  }
  const id = await tenantDb.runAs(request.userId, async (db) => {
    const repository = new ArtifactsRepository(db);
    const artifactId = await repository.insertArtifact({
      chatId: request.chatId,
      seq,
      toolName: request.toolName,
      toolCallId: request.toolCallId,
      runId: request.runId,
      complete: request.complete,
    });
    await repository.insertParts(artifactId, parts);
    return artifactId;
  });

  return {
    id,
    seq,
    locator: formatArtifactLocator(request.toolName, seq),
    lineCount: sum(parts, (part) => part.lineCount),
    byteSize: sum(parts, (part) => part.byteSize),
  };
}

function sum(
  parts: ReadonlyArray<NewArtifactPart>,
  value: (part: NewArtifactPart) => number,
): number {
  return parts.reduce((total, part) => total + value(part), 0);
}

/**
 * The stored row of one part: its bytes, digest, and sized as the reader
 * numbers it. A part over `tools.artifacts.maxBytes` is a failed write — the
 * producer must have bounded its stream.
 */
function preparePart(
  part: ArtifactPartInput,
  maxBytes: number,
): NewArtifactPart {
  if (part.content.byteLength > maxBytes) {
    throw new Error('An artifact part exceeds tools.artifacts.maxBytes.');
  }
  return {
    name: part.name ?? '',
    contentType: part.contentType,
    content: part.content,
    sha256: createHash('sha256').update(part.content).digest('hex'),
    byteSize: part.content.byteLength,
    lineCount: artifactLineCount(part.content.toString('utf8')),
    findings: part.findings ?? null,
  };
}
