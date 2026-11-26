import {
  applySelectorSuffix,
  fileMediaType,
  outlineReader,
  similarNames,
  measureReadRendering,
  resolveEndRelativeSelector,
  selectMultiRangeLines,
  selectSourceLines,
  MAX_RESULT_CODE_UNITS,
  type ReadSuccess,
  type ReadTarget,
} from '@workspace/native-file-tools';
import type {
  Entry,
  FsListResult,
  FsReadResult,
  FsStatResult,
  NativeFailureResult,
} from '@workspace/machine-protocol';
import { EntryKind, FileFailureReason } from '@workspace/machine-protocol';
import type { Handler } from './index.js';
import type {
  MachineRequestOptions,
  MachineSession,
} from '../machine-session.js';
import {
  failure,
  isNativeFailure,
  isNativeFailureType,
  mapEntryKind,
  READ_WINDOW_LINES,
  renderPath,
  rpc,
} from './files-common.js';
import { listDirectory } from './files-read-directory.js';

type ReadWindowRequest = { path: string; start: number; limit: number };

type ReadWindow = {
  lines: Array<string>;
  count: number;
  ending: string;
  truncated: boolean;
};

type TextReadRequest = {
  path: string;
  params: Parameters<Handler<'fs.read'>>[1];
  target: ReadTarget;
  lines: Array<string>;
  ending: string;
  lineOffset: number;
  lineCount: number;
  windowTruncated: boolean;
};

type SelectedReadWindow = {
  lines: Array<string>;
  ending: string;
  target: ReadTarget;
  lineOffset: number;
  lineCount: number;
  windowTruncated: boolean;
};


async function getEntry(
  session: MachineSession,
  path: string,
  options?: MachineRequestOptions,
): Promise<Entry | NativeFailureResult> {
  const response = await rpc(
    session,
    (files, callOptions) => files.getEntry({ path }, callOptions),
    options,
  );

  if (response.result.case === 'failure') {
    return (
      failure(response.result.value) ?? {
        status: 'error',
        type: 'executor_unavailable',
        message: 'File entry could not be read.',
      }
    );
  }

  if (response.result.case !== 'entry') {
    throw new Error('File entry response did not contain an entry.');
  }

  return response.result.value;
}

export async function readRange(
  session: MachineSession,
  request: ReadWindowRequest,
  options?: MachineRequestOptions,
): Promise<ReadWindow | NativeFailureResult> {
  const { path, start, limit } = request;

  const response = await rpc(
    session,
    (files, callOptions) =>
      files.readLines(
        { path, startLine: start, limit, maxBytes: 4n * 1024n * 1024n },
        callOptions,
      ),
    options,
  );

  if (response.result.case === 'failure') {
    return (
      failure(response.result.value) ?? {
        status: 'error',
        type: 'executor_unavailable',
        message: 'File lines could not be read.',
      }
    );
  }

  if (response.result.case !== 'lines') {
    throw new Error('File lines response did not contain lines.');
  }

  const lines = response.result.value;

  return {
    lines: lines.lines,
    count: lines.lineCount,
    ending: lines.lineEnding || '\n',
    truncated: lines.truncated,
  };
}

export const statHandler: Handler<'fs.stat'> = async (
  session,
  params,
  options,
) => {
  const response = await rpc(
    session,
    (files, callOptions) => files.getEntry({ path: params.path }, callOptions),
    options,
  );

  if (response.result.case === 'failure') {
    if (response.result.value.reason === FileFailureReason.NOT_FOUND) {
      return { kind: 'missing', isLink: false } satisfies FsStatResult;
    }

    throw new Error(response.result.value.message);
  }

  if (response.result.case !== 'entry') {
    throw new Error('File entry response did not contain an entry.');
  }

  const entry = response.result.value;

  const kind: FsStatResult['kind'] =
    entry.kind === EntryKind.FILE
      ? 'file'
      : entry.kind === EntryKind.DIRECTORY
        ? 'directory'
        : 'other';

  const stat = {
    kind,
    realPath: entry.canonicalPath ?? entry.name,
    isLink: entry.kind === EntryKind.SYMLINK,
  };

  return entry.size === undefined
    ? (stat satisfies FsStatResult)
    : ({ ...stat, size: Number(entry.size) } satisfies FsStatResult);
};

function missingFileResult(
  path: string,
  names: Array<string>,
): NativeFailureResult {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  const suggestions = similarNames(basename, names);

  return {
    status: 'error',
    type: 'not_found',
    message:
      suggestions.length === 0
        ? 'File not found.'
        : `File not found. Similar names in the same directory: ${suggestions.join(', ')}.`,
  };
}

async function suggestMissingPath(
  session: MachineSession,
  path: string,
  options?: MachineRequestOptions,
): Promise<NativeFailureResult> {
  const parentPath = path.slice(0, path.lastIndexOf('/')) || '/';

  const response = await rpc(
    session,
    (files, callOptions) =>
      files.listDirectory(
        { path: parentPath, offset: 0, limit: 1000 },
        callOptions,
      ),
    options,
  );

  if (response.result.case === 'failure') {
    if (failure(response.result.value)?.type === 'not_found') {
      return {
        status: 'error',
        type: 'not_found',
        message: 'File not found. Parent directory does not exist.',
      };
    }

    return (
      failure(response.result.value) ?? {
        status: 'error',
        type: 'not_found',
        message: 'File not found.',
      }
    );
  }

  if (response.result.case !== 'directory') {
    throw new Error('Parent directory response did not contain a listing.');
  }

  return missingFileResult(
    path,
    response.result.value.entries.map((item) => item.name),
  );
}

function shiftTarget(target: ReadTarget, offset: number): ReadTarget {
  return {
    ...target,
    offset: target.offset - offset,
    ...(target.ranges !== undefined && {
      ranges: target.ranges.map((range) => ({
        ...range,
        offset: range.offset - offset,
      })),
    }),
    ...(target.expandedRanges !== undefined && {
      expandedRanges: target.expandedRanges.map((range) => ({
        ...range,
        offset: range.offset - offset,
      })),
    }),
  };
}

async function resolveReadTarget(
  session: MachineSession,
  path: string,
  target: ReadTarget,
  options?: MachineRequestOptions,
): Promise<ReadTarget | NativeFailureResult> {
  if (target.pending === undefined) return target;

  const count = await readRange(session, { path, start: 1, limit: 1 }, options);

  if (isNativeFailure(count)) return count;

  return resolveEndRelativeSelector(target, count.count);
}

function readWindowBounds(target: ReadTarget) {
  const intervals = target.expandedRanges ?? target.ranges;
  const requestedStart = intervals?.[0]?.offset ?? target.offset;

  const lineOffset = target.raw
    ? requestedStart
    : Math.max(0, requestedStart - 1);

  const end = intervals
    ? Math.max(...intervals.map((range) => range.offset + range.limit))
    : target.offset + (target.limit ?? READ_WINDOW_LINES);

  const requestedLines =
    target.limit === undefined && target.ranges === undefined
      ? READ_WINDOW_LINES
      : end - lineOffset + (target.raw ? 0 : 1);

  return {
    lineOffset,
    requestedLines,
    limit: Math.min(requestedLines, READ_WINDOW_LINES),
  };
}

async function readAllLines(
  session: MachineSession,
  path: string,
  requestedTarget: ReadTarget,
  options?: MachineRequestOptions,
): Promise<SelectedReadWindow | NativeFailureResult> {
  const target = await resolveReadTarget(
    session,
    path,
    requestedTarget,
    options,
  );

  if (isNativeFailure(target)) return target;

  const bounds = readWindowBounds(target);

  const window = await readRange(
    session,
    { path, start: bounds.lineOffset + 1, limit: bounds.limit },
    options,
  );

  if (isNativeFailure(window)) return window;

  return {
    lines: window.lines,
    ending: window.ending,
    target: shiftTarget(target, bounds.lineOffset),
    lineOffset: bounds.lineOffset,
    lineCount: window.count,
    windowTruncated:
      bounds.requestedLines > bounds.limit || window.truncated,
  };
}

function shiftLineRange(
  range: { startLine: number; endLine: number } | null,
  offset: number,
) {
  return range === null
    ? null
    : {
        startLine: range.startLine + offset,
        endLine: range.endLine + offset,
      };
}

function rebaseReadRanges(result: ReadSuccess, offset: number): ReadSuccess {
  if ('shownRange' in result) {
    return {
      ...result,
      requestedRange: shiftLineRange(result.requestedRange, offset),
      shownRange: shiftLineRange(result.shownRange, offset),
    };
  }

  return {
    ...result,
    requestedRanges: result.requestedRanges.map((range) =>
      shiftLineRange(range, offset),
    ),
    shownRanges: result.shownRanges.map((range) =>
      shiftLineRange(range, offset)!,
    ),
  };
}

function rebaseReadResult(
  result: ReadSuccess,
  request: TextReadRequest,
  displayPath: string,
): ReadSuccess {
  const { target, lines, lineOffset, lineCount, windowTruncated } = request;

  const content =
    result.representation === 'raw'
      ? result.content
      : result.content.replaceAll(
          /^(\d+): /gmu,
          (_match, number: string) => `${Number(number) + lineOffset}: `,
        );

  const truncated =
    result.truncated ||
    windowTruncated ||
    (target.limit === undefined &&
      target.ranges === undefined &&
      lineOffset + lines.length < lineCount);

  const shifted = {
    ...result,
    path: displayPath,
    content,
    ...(result.representation !== 'outline' && { lineCount }),
    truncated,
    ...((result.nextOffset !== undefined || truncated) && {
      nextOffset: (result.nextOffset ?? lines.length) + lineOffset,
    }),
  };

  return rebaseReadRanges(shifted, lineOffset);
}

async function selectReadContent(
  request: TextReadRequest,
): Promise<FsReadResult> {
  const { path, params, target, lines, ending } = request;
  const source = lines.map((line) => `${line}${ending}`).join('');
  const displayPath = renderPath(path, params.options.displayPrefix);

  const reserveCodeUnits =
    (params.options.reserveCodeUnits ?? 0) + displayPath.length - path.length;

  const resolved = resolveEndRelativeSelector(
    { ...target, reserveCodeUnits },
    lines.length,
  );

  const selected = target.outline
    ? await outlineReader(fileMediaType(path))(lines, resolved)
    : target.ranges !== undefined
      ? selectMultiRangeLines(source, resolved)
      : selectSourceLines(source, resolved, fileMediaType(path));

  return rebaseReadResult(selected, request, displayPath);
}

function exceedsReadLimit(
  result: FsReadResult,
  reserveCodeUnits: number,
): boolean {
  return (
    measureReadRendering(result) >
    Math.min(MAX_RESULT_CODE_UNITS - reserveCodeUnits, 16_000)
  );
}

async function renderTextRead(request: TextReadRequest): Promise<FsReadResult> {
  try {
    const reserveCodeUnits = request.params.options.reserveCodeUnits ?? 0;
    const result = await selectReadContent(request);

    if (exceedsReadLimit(result, reserveCodeUnits)) {
      return {
        status: 'error',
        type: 'representation_too_large',
        message: 'The rendered read exceeds the 16 000-unit result bound.',
      };
    }

    return result;
  } catch (error) {
    const errorType =
      error instanceof Object && 'type' in error ? error.type : undefined;

    return {
      status: 'error',
      type: isNativeFailureType(errorType) ? errorType : 'invalid_selector',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readTextFile(
  session: MachineSession,
  params: Parameters<Handler<'fs.read'>>[1],
  target: ReadTarget,
  options?: MachineRequestOptions,
): Promise<FsReadResult> {
  if (target.outline && fileMediaType(params.path) !== 'text/markdown') {
    return {
      status: 'error',
      type: 'invalid_selector',
      message:
        'The :outline member reads text/markdown content only; read this source without it.',
    };
  }

  const content = await readAllLines(session, params.path, target, options);

  if ('status' in content) return content;

  return renderTextRead({
    path: params.path,
    params,
    target: content.target,
    lines: content.lines,
    ending: content.ending,
    lineOffset: content.lineOffset,
    lineCount: content.lineCount,
    windowTruncated: content.windowTruncated,
  });
}

export const readHandler: Handler<'fs.read'> = async (
  session,
  params,
  options,
) => {
  let target: ReadTarget;

  try {
    target = applySelectorSuffix(params.path, params.options.selector);
  } catch (error) {
    return {
      status: 'error',
      type: 'invalid_selector',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const entry = await getEntry(session, params.path, options);

  if (isNativeFailure(entry))
    return suggestMissingPath(session, params.path, options);

  if (entry.kind === EntryKind.DIRECTORY) {
    return listDirectory(session, {
      path: params.path,
      prefix: params.options.displayPrefix,
      reserveCodeUnits: params.options.reserveCodeUnits ?? 0,
      options,
    });
  }

  return readTextFile(session, params, target, options);
};

export const listHandler: Handler<'fs.list'> = async (
  session,
  params,
  options,
) => {
  const response = await rpc(
    session,
    (files, callOptions) =>
      files.listDirectory(
        { path: params.path, offset: 0, limit: 1000 },
        callOptions,
      ),
    options,
  );

  if (response.result.case === 'failure') {
    return (
      failure(response.result.value) ?? {
        status: 'error',
        type: 'executor_unavailable',
        message: 'Directory listing failed.',
      }
    );
  }

  if (response.result.case !== 'directory') {
    throw new Error('Directory response did not contain a listing.');
  }

  const directory = response.result.value;

  return {
    entries: directory.entries.map((entry) => ({
      name: entry.name,
      kind: mapEntryKind(entry.kind),
    })),
    totalCount: directory.total,
    truncated: directory.entries.length < directory.total,
  } satisfies FsListResult;
};
