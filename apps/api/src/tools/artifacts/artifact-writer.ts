import { createHash } from 'node:crypto';

import { type TenantRunner } from '../../db/tenant-db.service';
import {
  ArtifactsRepository,
  type NewArtifactPart,
} from './artifacts-repository';
import { artifactLineCount } from './lines';
import { formatArtifactLocator, isLocatorName } from './locator';

/** A part name a host-file path can be built from. */
const PART_NAME = /^[a-z][a-z0-9_-]*$/u;

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
  const parts = prepareParts(request, options.maxBytes);
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
    lineCount: parts.reduce((total, part) => total + part.lineCount, 0),
    byteSize: parts.reduce((total, part) => total + part.byteSize, 0),
  };
}

/**
 * The request's parts as stored rows. The artifact's shape is decided before
 * the counter moves: a part over `tools.artifacts.maxBytes`, an unusable tool
 * or part name, and an ambiguous part set are failed writes, so no artifact is
 * numbered for a result the store cannot hold.
 */
function prepareParts(
  request: ArtifactWriteRequest,
  maxBytes: number,
): Array<NewArtifactPart> {
  if (!isLocatorName(request.toolName)) {
    throw new Error(`"${request.toolName}" is not a usable artifact tool name`);
  }
  const parts = request.parts.map((part) => preparePart(part, maxBytes));
  assertPartNames(parts.map((part) => part.name));
  return parts;
}

/**
 * A part set is either one unnamed part or only named parts, and each name is
 * unique and path-safe, because the materialize layer builds a host file path
 * from it.
 */
function assertPartNames(names: ReadonlyArray<string>): void {
  if (names.length === 0) {
    throw new Error('An artifact needs at least one part.');
  }
  if (names.length > 1 && names.some((name) => name === '')) {
    throw new Error('An artifact with several parts names every part.');
  }
  for (const name of names) {
    if (name !== '' && !PART_NAME.test(name)) {
      throw new Error(`"${name}" is not a usable artifact part name`);
    }
  }
  if (new Set(names).size !== names.length) {
    throw new Error('An artifact part names must be distinct.');
  }
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
