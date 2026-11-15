import {
  applySelectorSuffix,
  parsePathScheme,
  resolveEndRelativeSelector,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';

import { type Db } from '../../db/tenant-db.service';
import { renderListing, type ListingRefusal } from '../listing-window';
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

  return renderListing(BARE_LOCATOR, entries, selector, {
    emptyContent: `${BARE_LOCATOR}\n(no artifacts)\n`,
    refuse: listingRefusal,
  });
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

  return renderListing(path, entries, selector, {
    emptyContent: `${path}\n(no streams)\n`,
    refuse: listingRefusal,
  });
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
