import { z } from 'zod';
import { create } from '@bufbuild/protobuf';
import {
  fsGrepCursorKey,
  SearchFilesRequestSchema,
  SearchStop,
  SkipReason,
  FileFailureReason,
  type FsGrepParams,
  type FsGrepPassage,
  type FsGrepResult,
  type FsGrepWarningKind,
  type SearchFilesResponse,
} from '@workspace/machine-protocol';
import { GREP_LIMITS, grepPassageUnits } from '@workspace/native-file-tools';
import type { GrepPassage } from '@workspace/native-file-tools';
import type { SearchEnd } from '@workspace/machine-protocol';
import type {
  MachineSession,
  MachineRequestOptions,
} from '../machine-session.js';
import type { Handler } from './index.js';

type SearchPositionValue = { readonly path: string; readonly line: number };

type HubCursor = {
  readonly after: SearchPositionValue;
  readonly inputHash: string;
};

const hubCursorSchema = z.object({
  after: z.object({
    path: z.string(),
    line: z.number().int().safe().nonnegative(),
  }),
  inputHash: z.string(),
});

type MatchEvent = Extract<
  SearchFilesResponse['event'],
  { case: 'match' }
>['value'];

type PassageGroup = {
  path: string;
  startLine: number;
  endLine: number;
  lines: Map<number, string>;
  matches: Array<number>;
};

function cursorEncode(cursor: HubCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function cursorDecode(
  text: string,
  inputHash: string,
): SearchPositionValue | undefined {
  if (!/^[\w-]+$/u.test(text)) return undefined;

  try {
    const parsed = hubCursorSchema.safeParse(
      JSON.parse(Buffer.from(text, 'base64url').toString('utf8')),
    );

    if (!parsed.success || parsed.data.inputHash !== inputHash)
      return undefined;

    return parsed.data.after;
  } catch {
    return undefined;
  }
}

function warningKind(reason: SkipReason): FsGrepWarningKind | undefined {
  switch (reason) {
    case SkipReason.BINARY:
      return 'binary';
    case SkipReason.NOT_UTF8:
      return 'invalid_utf8';
    case SkipReason.TOO_LARGE:
      return 'oversized';
    case SkipReason.UNREADABLE:
      return 'unreadable';
    case SkipReason.SYMLINK:
      return 'link';
    case SkipReason.IGNORED:
    case SkipReason.UNSPECIFIED:
      return undefined;
    default:
      return undefined;
  }
}

function searchFailureType(
  reason: FileFailureReason,
): Extract<FsGrepResult, { status: 'error' }>['type'] {
  switch (reason) {
    case FileFailureReason.NOT_FOUND:
      return 'not_found';
    case FileFailureReason.WRONG_KIND:
      return 'not_regular_file';
    case FileFailureReason.NOT_UTF8:
      return 'invalid_utf8';
    case FileFailureReason.ALREADY_EXISTS:
      return 'file_exists';
    case FileFailureReason.TEXT_NOT_FOUND:
      return 'old_text_not_found';
    case FileFailureReason.TEXT_AMBIGUOUS:
      return 'old_text_ambiguous';
    case FileFailureReason.OUTCOME_UNKNOWN:
      return 'outcome_unknown';
    case FileFailureReason.DIRECTORY_TOO_LARGE:
      return 'directory_too_large';
    case FileFailureReason.FILE_TOO_LARGE:
      return 'representation_too_large';
    case FileFailureReason.IO:
    case FileFailureReason.UNSPECIFIED:
      return 'invalid_path';
    default:
      return 'invalid_path';
  }
}

function groupsFrom(matches: ReadonlyArray<MatchEvent>): Array<PassageGroup> {
  const groups: Array<PassageGroup> = [];
  let current: PassageGroup | undefined;

  for (const match of matches) {
    const first = match.lines[0]?.number ?? match.line;
    const last = match.lines.at(-1)?.number ?? match.line;

    if (
      current === undefined ||
      current.path !== match.path ||
      first > current.endLine + 1
    ) {
      current = {
        path: match.path,
        startLine: first,
        endLine: last,
        lines: new Map(),
        matches: [],
      };
      groups.push(current);
    }

    current.startLine = Math.min(current.startLine, first);
    current.endLine = Math.max(current.endLine, last);

    for (const line of match.lines) current.lines.set(line.number, line.text);
    current.matches.push(match.line);
  }

  return groups;
}

function numbered(
  group: PassageGroup,
  from = group.startLine,
  to = group.endLine,
): string {
  const lines: Array<string> = [];

  for (let line = from; line <= to; line += 1) {
    const text = group.lines.get(line);

    if (text !== undefined) {
      const shown =
        text.length > GREP_LIMITS.lineCodeUnits
          ? `${text.slice(0, GREP_LIMITS.lineCodeUnits)}…`
          : text;

      lines.push(`${line}: ${shown}`);
    }
  }

  return lines.join('\n');
}

function asNativePassage(group: PassageGroup): GrepPassage {
  return {
    locator: `${group.path}:L${group.startLine}-${group.endLine}`,
    content: numbered(group),
    matches: group.matches,
  };
}

function toResultPassage(passage: GrepPassage, capped: boolean): FsGrepPassage {
  const separator = passage.locator.lastIndexOf(':L');
  const path = passage.locator.slice(0, separator);
  const range = passage.locator.slice(separator + 2).split('-');
  const startLine = Number(range[0]);
  const endLine = Number(range[1]);

  return {
    path,
    startLine,
    endLine,
    content: passage.content,
    matches: passage.matches,
    ...(capped && { capped: true as const }),
    ...(passage.cut && { cut: true as const }),
  };
}

function encodeSearchRequest(
  params: FsGrepParams,
  after?: SearchPositionValue,
) {
  return create(SearchFilesRequestSchema, {
    path: params.path,
    glob: params.globSuffix ?? '',
    patterns: [...params.patterns],
    literal: params.literal,
    ignoreCase: params.ignoreCase,
    contextLines: GREP_LIMITS.contextLines,
    respectIgnoreFiles: true,
    ...(after && { after }),
    bounds: {
      ...(params.bounds.files !== null && { files: params.bounds.files }),
      ...(params.bounds.bytes !== null && {
        bytes: BigInt(params.bounds.bytes),
      }),
      ...(params.bounds.fileBytes !== null && {
        fileBytes: BigInt(params.bounds.fileBytes),
      }),
      ...(params.bounds.limit > 0 && { matches: params.bounds.limit }),
    },
  });
}

function continuationUnits(cursor: HubCursor): number {
  return (
    `[more results. Continue with cursor: ${cursorEncode(cursor)}]`.length + 1
  );
}

type PageGroupsOptions = {
  readonly groups: Array<PassageGroup>;
  readonly cappedGroups: ReadonlySet<PassageGroup>;
  readonly params: FsGrepParams;
  readonly inputHash: string;
  readonly daemonHasMore: boolean;
};

type PageGroupsResult = { results: Array<FsGrepPassage>; cursor?: string };

function cutGroup(group: PassageGroup, inputHash: string, pageUnits: number) {
  const passage = asNativePassage(group);
  const lines = passage.content.split('\n');
  let fitting = 0;

  for (let lineCount = 1; lineCount <= lines.length; lineCount += 1) {
    const end = group.startLine + lineCount - 1;

    const candidate: GrepPassage = {
      ...passage,
      locator: `${group.path}:L${group.startLine}-${end}`,
      content: lines.slice(0, lineCount).join('\n'),
      matches: group.matches.filter((line) => line <= end),
      cut: true,
    };

    const cursor = { after: { path: group.path, line: end }, inputHash };

    if (
      grepPassageUnits(undefined, candidate) + continuationUnits(cursor) >
      pageUnits
    )
      break;
    fitting = lineCount;
  }

  fitting = Math.max(1, fitting);
  const end = Math.min(group.endLine, group.startLine + fitting - 1);

  return {
    passage: {
      ...passage,
      locator: `${group.path}:L${group.startLine}-${end}`,
      content: lines.slice(0, fitting).join('\n'),
      matches: group.matches.filter((line) => line <= end),
      cut: true as const,
    },
    cursor: cursorEncode({ after: { path: group.path, line: end }, inputHash }),
  };
}

function pageOverflows(options: {
  readonly previous?: FsGrepPassage;
  readonly passage: GrepPassage;
  readonly hasMore: boolean;
  readonly next: HubCursor;
  readonly pageUnits: number;
}): boolean {
  const previous = options.previous;

  const previousNative =
    previous === undefined
      ? undefined
      : {
          locator: `${previous.path}:L${previous.startLine}-${previous.endLine}`,
          content: previous.content,
          matches: previous.matches,
        };

  return (
    grepPassageUnits(previousNative, options.passage) +
      (options.hasMore ? continuationUnits(options.next) : 0) >
    options.pageUnits
  );
}

function pageGroups(options: PageGroupsOptions): PageGroupsResult {
  const { groups, cappedGroups, params, inputHash, daemonHasMore } = options;
  const results: Array<FsGrepPassage> = [];
  let previous: FsGrepPassage | undefined;

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];

    if (group === undefined) continue;

    const passage = asNativePassage(group);

    const next = {
      after: { path: group.path, line: group.endLine },
      inputHash,
    };

    const hasMore = index + 1 < groups.length || daemonHasMore;

    if (
      pageOverflows({
        previous,
        passage,
        hasMore,
        next,
        pageUnits: params.bounds.pageUnits,
      })
    ) {
      if (previous !== undefined) {
        return {
          results,
          cursor: cursorEncode({
            after: { path: previous.path, line: previous.endLine },
            inputHash,
          }),
        };
      }

      const cut = cutGroup(group, inputHash, params.bounds.pageUnits);
      results.push(toResultPassage(cut.passage, cappedGroups.has(group)));

      return { results, cursor: cut.cursor };
    }

    previous = toResultPassage(passage, cappedGroups.has(group));
    results.push(previous);
  }

  return { results };
}

type SearchFailure = Extract<FsGrepResult, { status: 'error' }>;

type SearchCollection = {
  readonly matches: Array<MatchEvent>;
  readonly warningCounts: Map<FsGrepWarningKind, number>;
  readonly ignoredPaths: Array<string>;
  readonly end?: SearchEnd;
};

type SearchCollectionState = {
  matches: Array<MatchEvent>;
  warningCounts: Map<FsGrepWarningKind, number>;
  ignoredPaths: Array<string>;
  end?: SearchEnd;
};

function consumeResponse(
  state: SearchCollectionState,
  response: SearchFilesResponse,
): SearchFailure | undefined {
  switch (response.event.case) {
    case 'match':
      state.matches.push(response.event.value);

      return undefined;
    case 'skipped': {
      const { path, reason } = response.event.value;
      const kind = warningKind(reason);

      if (kind !== undefined) {
        state.warningCounts.set(kind, (state.warningCounts.get(kind) ?? 0) + 1);
      } else if (
        reason === SkipReason.IGNORED &&
        state.ignoredPaths.length < GREP_LIMITS.ignoredLocators
      ) {
        state.ignoredPaths.push(path);
      }

      return undefined;
    }

    case 'end':
      state.end = response.event.value;

      return undefined;
    case 'failure':
      return {
        status: 'error',
        type: searchFailureType(response.event.value.reason),
        message: response.event.value.message,
      };
    case undefined:
      return undefined;
  }
}

async function collectSearch(
  session: MachineSession,
  params: FsGrepParams,
  after: SearchPositionValue | undefined,
  options?: MachineRequestOptions,
): Promise<SearchCollection | SearchFailure> {
  const stream = session.clients.files.searchFiles(
    encodeSearchRequest(params, after),
    session.callOptions({
      ...options,
      envelope: options?.envelope ?? params.envelope,
    }),
  );

  const state: SearchCollectionState = {
    matches: [],
    warningCounts: new Map(),
    ignoredPaths: [],
  };

  try {
    for await (const response of stream) {
      const failure = consumeResponse(state, response);

      if (failure !== undefined) return failure;
    }
  } catch (error) {
    throw session.mapRefusal(error);
  }

  return state;
}

function limitPassages(groups: Array<PassageGroup>) {
  const countsByFile = new Map<string, number>();

  for (const group of groups) {
    countsByFile.set(group.path, (countsByFile.get(group.path) ?? 0) + 1);
  }

  const limitedGroups: Array<PassageGroup> = [];
  const cappedGroups = new Set<PassageGroup>();
  const emittedByFile = new Map<string, number>();

  for (const group of groups) {
    const emitted = emittedByFile.get(group.path) ?? 0;

    if (emitted === 20) continue;

    emittedByFile.set(group.path, emitted + 1);
    limitedGroups.push(group);

    if (emitted === 19 && (countsByFile.get(group.path) ?? 0) > 20) {
      cappedGroups.add(group);
    }
  }

  return { groups: limitedGroups, cappedGroups };
}

type SearchSuccessMutable = Omit<
  Extract<FsGrepResult, { ok: true }>,
  'cursor' | 'unfinished' | 'ignored'
> & {
  cursor?: string;
  unfinished?: string;
  ignored?: { paths: Array<string>; atLeast: boolean };
};

function searchResult(options: {
  readonly params: FsGrepParams;
  readonly page: PageGroupsResult;
  readonly inputHash: string;
  readonly end?: SearchEnd;
  readonly warningCounts: Map<FsGrepWarningKind, number>;
  readonly ignoredPaths: Array<string>;
}): FsGrepResult {
  const { params, page, inputHash, end, warningCounts, ignoredPaths } = options;
  const daemonPosition = end?.position;

  const complete =
    end?.stop === SearchStop.COMPLETE && page.cursor === undefined;

  const cursor =
    page.cursor ??
    (!complete && daemonPosition
      ? cursorEncode({ after: daemonPosition, inputHash })
      : undefined);

  const progressed = params.bounds.progressed || (end?.files ?? 0) > 0;

  const result: SearchSuccessMutable = {
    ok: true,
    results: page.results,
    complete,
    warnings: [...warningCounts].map(([kind, count]) => ({ kind, count })),
    consumed: {
      files: end?.files ?? 0,
      entries: end?.files ?? 0,
      bytes: Number(end?.bytes ?? 0n),
    },
    progressed,
  };

  if (cursor !== undefined) result.cursor = cursor;

  if (!complete && !progressed && daemonPosition !== undefined) {
    result.unfinished = daemonPosition.path;
  }

  if (ignoredPaths.length > 0)
    result.ignored = { paths: ignoredPaths, atLeast: false };

  return result;
}

export const searchHandlers: Partial<Record<'fs.grep', Handler<'fs.grep'>>> = {
  'fs.grep': async (
    session: MachineSession,
    params: FsGrepParams,
    options?: MachineRequestOptions,
  ): Promise<FsGrepResult> => {
    const inputHash = fsGrepCursorKey(params);

    const after =
      params.cursor === undefined
        ? undefined
        : cursorDecode(params.cursor, inputHash);

    if (params.cursor !== undefined && after === undefined) {
      return {
        status: 'error',
        type: 'invalid_input',
        message:
          'The grep cursor is invalid or belongs to different search inputs.',
      };
    }

    const collection = await collectSearch(session, params, after, options);

    if ('status' in collection) return collection;

    const limited = limitPassages(groupsFrom(collection.matches));

    const page = pageGroups({
      groups: limited.groups,
      cappedGroups: limited.cappedGroups,
      params,
      inputHash,
      daemonHasMore:
        collection.end?.stop !== SearchStop.COMPLETE &&
        collection.end?.position !== undefined,
    });

    return searchResult({
      params,
      page,
      inputHash,
      end: collection.end,
      warningCounts: collection.warningCounts,
      ignoredPaths: collection.ignoredPaths,
    });
  },
};
