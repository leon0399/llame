import {
  applySelectorSuffix,
  boundFlatResult,
  directoryResult,
  MAX_RESULT_CODE_UNITS,
  NativeFileError,
  outlineReader,
  resolveEndRelativeSelector,
  selectMultiRangeLines,
  selectSourceLines,
  splitSelectorSuffix,
  splitSourceLines,
  type ReadTarget,
} from '@workspace/native-file-tools';

import { type ToolContext, type ToolResult } from '../types';
import {
  ArtifactsRepository,
  type ArtifactPartSummary,
  type StoredPart,
} from './artifacts-repository';
import { artifactLinePieces, artifactText } from './lines';
import {
  ARTIFACT_SCHEME,
  formatArtifactLocator,
  parseArtifactLocatorText,
  type ArtifactLocator,
} from './locator';

export { ARTIFACT_SCHEME };

const BARE_LOCATOR = `${ARTIFACT_SCHEME}://`;

/**
 * The `artifact://` reader (tool-result-artifacts D2). It routes before local
 * path resolution, needs no native executor, and reads one Chat's stored
 * artifacts through the Chat-owner RLS identity. A bare locator lists the Chat's
 * artifacts; a multi-part (or `bash`) artifact lists its streams; a locator that
 * names no part reads the artifact's single unnamed part.
 */
export async function readArtifact(
  context: ToolContext,
  operation: 'read' | 'edit' | 'write',
  submitted: string,
): Promise<ToolResult> {
  if (operation !== 'read') {
    return {
      status: 'error',
      type: 'invalid_path',
      message:
        'Artifact locators are read-only; edit and write cannot target them.',
    };
  }
  const { path, selector } = splitSelectorSuffix(submitted);
  if (path === BARE_LOCATOR) return listChatArtifacts(context, selector);
  const locator = parseArtifactLocatorText(path);
  if (locator === undefined) return invalidLocatorResult();

  context.abortSignal?.throwIfAborted();
  return context.tenantDb.runAs(context.userId, (db) =>
    readLocator(new ArtifactsRepository(db), {
      chatId: context.chatId,
      path,
      locator,
      selector,
    }),
  );
}

type LocatorRead = {
  readonly chatId: string;
  readonly path: string;
  readonly locator: ArtifactLocator;
  readonly selector: string | undefined;
};

async function readLocator(
  repository: ArtifactsRepository,
  { chatId, path, locator, selector }: LocatorRead,
): Promise<ToolResult> {
  const artifact = await repository.find(chatId, locator.toolName, locator.seq);
  if (artifact === undefined) return notFoundResult();
  if (locator.part !== undefined) {
    const part = await repository.findPart(artifact.id, locator.part);
    return part === undefined
      ? notFoundResult()
      : readPart(path, part, selector);
  }
  const parts = await repository.listParts(artifact.id);
  const single = parts[0];
  if (single === undefined) return notFoundResult();
  if (single.name !== '') return listStreams(path, parts, selector);
  const part = await repository.findPart(artifact.id, '');
  return part === undefined ? notFoundResult() : readPart(path, part, selector);
}

async function listChatArtifacts(
  context: ToolContext,
  selector: string | undefined,
): Promise<ToolResult> {
  const rows = await context.tenantDb.runAs(context.userId, (db) =>
    new ArtifactsRepository(db).listChat(context.chatId),
  );
  const entries = rows.map(
    (row) =>
      `${formatArtifactLocator(row.toolName, row.seq)} (${row.toolName}, ${count(row.lineCount, 'line')}, ${count(row.byteSize, 'byte')}, ${row.createdAt.toISOString()})`,
  );
  return renderListing(BARE_LOCATOR, entries, selector, 'no artifacts');
}

function listStreams(
  path: string,
  parts: ReadonlyArray<ArtifactPartSummary>,
  selector: string | undefined,
): ToolResult {
  const entries = parts.map(
    (part) =>
      `${path}/${part.name} (${count(part.lineCount, 'line')}, ${count(part.byteSize, 'byte')})`,
  );
  return renderListing(path, entries, selector, 'no streams');
}

/** One part's text, numbered in 8,000-unit pieces, with the read selectors. */
async function readPart(
  path: string,
  part: StoredPart,
  selector: string | undefined,
): Promise<ToolResult> {
  try {
    const target = applySelectorSuffix(path, selector);
    const source = part.content.toString('utf8');
    const resolved = resolveEndRelativeSelector(
      target,
      artifactLinePieces(source).length,
    );
    const text = artifactText(source);
    if (resolved.outline) {
      return await outlineReader(part.contentType)(
        splitSourceLines(text),
        resolved,
      );
    }
    return resolved.ranges === undefined
      ? selectSourceLines(text, resolved, part.contentType)
      : selectMultiRangeLines(text, resolved, part.contentType);
  } catch (error) {
    if (error instanceof NativeFileError) {
      return { status: 'error', type: error.type, message: error.message };
    }
    throw error;
  }
}

/**
 * A listing page in the directory-list shape. Entries stay in the order the
 * caller produced — the Chat list is oldest first — and the shared page helpers
 * place the selector and cut the page to the read bound.
 */
function renderListing(
  path: string,
  entries: ReadonlyArray<string>,
  selector: string | undefined,
  emptyText: string,
): ToolResult {
  try {
    const target = applySelectorSuffix(path, selector);
    const refusal = listingSelectorRefusal(target);
    if (refusal !== undefined) return refusal;
    const resolved = resolveEndRelativeSelector(target, entries.length);
    const end = Math.min(
      resolved.offset + (resolved.limit ?? entries.length),
      entries.length,
    );
    const selected = entries.slice(resolved.offset, end);
    const page =
      selected.length === 0 && entries.length === 0
        ? `${path}\n(${emptyText})\n`
        : [path, ...selected].join('\n') + '\n';
    const result = directoryResult(path, entries.length, {
      content: page,
      truncated: end < entries.length,
      ...(end < entries.length && { nextOffset: end }),
    });
    return boundFlatResult(result, resolved.offset, MAX_RESULT_CODE_UNITS);
  } catch (error) {
    if (error instanceof NativeFileError) {
      return { status: 'error', type: error.type, message: error.message };
    }
    throw error;
  }
}

/** A listing has no second interval, no raw form, and no outline. */
function listingSelectorRefusal(target: ReadTarget): ToolResult | undefined {
  const message = target.outline
    ? 'The :outline member is not supported for artifact listings.'
    : target.raw
      ? 'The :raw selector is not supported for artifact listings.'
      : target.ranges !== undefined
        ? 'Comma-separated selectors are not supported for artifact listings.'
        : undefined;
  return message === undefined
    ? undefined
    : { status: 'error', type: 'invalid_selector', message };
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

function invalidLocatorResult(): ToolResult {
  return {
    status: 'error',
    type: 'invalid_path',
    message:
      'An artifact locator is artifact://<tool>-<n>, optionally followed by /<part>.',
  };
}

function notFoundResult(): ToolResult {
  return {
    status: 'error',
    type: 'not_found',
    message: 'The artifact or part is not found in this Chat.',
  };
}
