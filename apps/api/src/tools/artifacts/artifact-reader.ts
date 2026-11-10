import {
  applySelectorSuffix,
  boundFlatResult,
  directoryResult,
  MAX_RESULT_CODE_UNITS,
  parsePathScheme,
  resolveEndRelativeSelector,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';

import { type Db } from '../../db/tenant-db.service';
import { placeListingSelector, type ListingRefusal } from '../listing-window';
import { nativeErrorResult, selectInMemoryText } from '../text-selection';
import { type ToolContext, type ToolResult } from '../types';
import {
  ArtifactsRepository,
  type ArtifactParts,
  type StoredPart,
} from './artifacts-repository';
import { artifactText } from './lines';
import { withholdFindings } from './findings';
import {
  ARTIFACT_SCHEME,
  formatArtifactLocator,
  parseArtifactLocatorText,
  type ArtifactLocator,
} from './locator';

const BARE_LOCATOR = `${ARTIFACT_SCHEME}://`;

/**
 * The `artifact://` reader (tool-result-artifacts D2). It routes before local
 * path resolution, needs no native executor, and reads one Chat's stored
 * artifacts through the Chat-owner RLS identity. A bare locator lists the Chat's
 * artifacts; a multi-part (or `bash`) artifact lists its streams; a locator that
 * names no part reads the artifact's single unnamed part.
 */
export type ArtifactReadRepository = Pick<
  ArtifactsRepository,
  'readPart' | 'findParts'
>;

export async function readArtifact(
  context: ToolContext,
  operation: 'read' | 'edit' | 'write',
  submitted: string,
  repository: (db: Db) => ArtifactReadRepository = (db) =>
    new ArtifactsRepository(db),
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
  const scheme = parsePathScheme(path);

  if (scheme?.scheme === ARTIFACT_SCHEME && scheme.rest === '') {
    return listChatArtifacts(context, selector);
  }

  const locator = parseArtifactLocatorText(path);

  if (locator === undefined) return invalidLocatorResult();

  context.abortSignal?.throwIfAborted();

  return context.tenantDb.runAs(context.userId, (db) =>
    readLocator(context, repository(db), {
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

export async function readLocator(
  context: ToolContext,
  repository: ArtifactReadRepository,
  { chatId, path, locator, selector }: LocatorRead,
): Promise<ToolResult> {
  if (locator.part !== undefined) {
    const part = await repository.readPart(
      chatId,
      locator.toolName,
      locator.seq,
      locator.part,
    );

    return part === undefined
      ? notFoundResult()
      : readStoredPart(context, path, part, selector);
  }

  const found = await repository.findParts(
    chatId,
    locator.toolName,
    locator.seq,
  );

  if (found === undefined) return notFoundResult();

  if (found.parts.length === 1 && found.parts[0].name === '') {
    const part = await repository.readPart(
      chatId,
      locator.toolName,
      locator.seq,
      '',
    );

    return part === undefined
      ? notFoundResult()
      : readStoredPart(context, path, part, selector);
  }

  return listStreams(path, locator, found, selector);
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
  locator: ArtifactLocator,
  found: ArtifactParts,
  selector: string | undefined,
): ToolResult {
  const entries = found.parts.map(
    (part) =>
      `${path}/${part.name} (${locator.toolName}, ${count(part.lineCount, 'line')}, ${count(part.byteSize, 'byte')}, ${found.createdAt.toISOString()})`,
  );

  return renderListing(path, entries, selector, 'no streams');
}

/**
 * One stored part's text, numbered by its stored line count and then placed by
 * the shared selectors. Findings are withheld before selection, so every line
 * keeps its number and an outline built afterwards names no withheld file (D5).
 */
async function readStoredPart(
  context: ToolContext,
  path: string,
  part: StoredPart,
  selector: string | undefined,
): Promise<ToolResult> {
  try {
    const target = applySelectorSuffix(path, selector);
    const source = part.content.toString('utf8');

    const text = withholdFindings(
      context,
      part,
      artifactText(source),
      resolveEndRelativeSelector(target, part.lineCount),
    );

    return await selectInMemoryText({
      target,
      text,
      lineCount: part.lineCount,
      mediaType: part.contentType,
    });
  } catch (error) {
    const refused = nativeErrorResult(error);

    if (refused !== undefined) return refused;
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
  const placed = placeListingSelector(path, selector, entries.length);

  if ('refusal' in placed) return listingRefusal(placed.refusal);
  const { offset, limit } = placed.window;
  const end = Math.min(offset + (limit ?? entries.length), entries.length);

  const content =
    entries.length === 0
      ? `${path}\n(${emptyText})\n`
      : [path, ...entries.slice(offset, end)].join('\n') + '\n';

  const result = directoryResult(path, entries.length, {
    content,
    truncated: end < entries.length,
    ...(end < entries.length && { nextOffset: end }),
  });

  return boundFlatResult(result, offset, MAX_RESULT_CODE_UNITS);
}

/** A listing takes no second interval, no raw form, and no outline. */
function listingRefusal(refusal: ListingRefusal): ToolResult {
  const message =
    refusal === 'invalid'
      ? 'The artifact listing selector is invalid.'
      : refusal === 'outline'
        ? 'The :outline member is not supported for artifact listings.'
        : 'An artifact listing accepts a single :N-M, :N+K, :N-, or :-K range; comma ranges and :raw are not supported.';

  return { status: 'error', type: 'invalid_selector', message };
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
