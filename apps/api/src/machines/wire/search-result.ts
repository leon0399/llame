import {
  SearchStop,
  type FsGrepParams,
  type FsGrepPassage,
  type FsGrepResult,
  type FsGrepWarningKind,
  type SearchEnd,
} from '@workspace/machine-protocol';

import { cursorEncode } from './search-cursor.js';

type PageGroupsResult = { results: Array<FsGrepPassage>; cursor?: string };

type SearchSuccessMutable = Omit<
  Extract<FsGrepResult, { ok: true }>,
  'cursor' | 'unfinished' | 'ignored'
> & {
  cursor?: string;
  unfinished?: string;
  ignored?: { paths: Array<string>; atLeast: boolean };
};

function searchCursor(
  pageCursor: string | undefined,
  complete: boolean,
  position: SearchEnd['position'],
  inputHash: string,
): string | undefined {
  return (
    pageCursor ??
    (!complete && position
      ? cursorEncode({ after: position, inputHash })
      : undefined)
  );
}

function searchProgressed(
  params: FsGrepParams,
  end: SearchEnd | undefined,
  warningCounts: Map<FsGrepWarningKind, number>,
): boolean {
  const stoppedInsideUnmatchedFile =
    end?.stop === SearchStop.BYTES &&
    end.position?.byteOffset !== undefined &&
    end.matches === 0 &&
    !warningCounts.has('binary') &&
    !warningCounts.has('invalid_utf8');

  return (
    params.bounds.progressed ||
    ((end?.files ?? 0) > 0 && !stoppedInsideUnmatchedFile)
  );
}

function searchBaseResult(
  params: FsGrepParams,
  page: PageGroupsResult,
  end: SearchEnd | undefined,
  warningCounts: Map<FsGrepWarningKind, number>,
): SearchSuccessMutable {
  const complete =
    end?.stop === SearchStop.COMPLETE && page.cursor === undefined;

  const progressed = searchProgressed(params, end, warningCounts);

  return {
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
}

export function makeSearchResult(options: {
  readonly params: FsGrepParams;
  readonly page: PageGroupsResult;
  readonly inputHash: string;
  readonly end?: SearchEnd;
  readonly warningCounts: Map<FsGrepWarningKind, number>;
  readonly ignoredPaths: Array<string>;
  readonly ignoredAtLeast: boolean;
}): FsGrepResult {
  const {
    params,
    page,
    inputHash,
    end,
    warningCounts,
    ignoredPaths,
    ignoredAtLeast,
  } = options;

  const daemonPosition = end?.position;
  const result = searchBaseResult(params, page, end, warningCounts);

  const cursor = searchCursor(
    page.cursor,
    result.complete,
    daemonPosition,
    inputHash,
  );

  if (cursor !== undefined) result.cursor = cursor;

  if (!result.complete && !result.progressed && daemonPosition !== undefined)
    result.unfinished = daemonPosition.path;

  if (ignoredPaths.length > 0 || ignoredAtLeast)
    result.ignored = { paths: ignoredPaths, atLeast: ignoredAtLeast };

  return result;
}
