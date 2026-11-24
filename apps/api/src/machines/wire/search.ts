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
import type { MachineSession, MachineRequestOptions } from '../machine-session.js';
import type { Handler } from './index.js';

type SearchPositionValue = { readonly path: string; readonly line: number };
type HubCursor = { readonly after: SearchPositionValue; readonly inputHash: string };
type MatchEvent = Extract<SearchFilesResponse['event'], { case: 'match' }>['value'];

type PassageGroup = { path: string; startLine: number; endLine: number; lines: Map<number, string>; matches: number[] };

function cursorEncode(cursor: HubCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function cursorDecode(text: string, inputHash: string): SearchPositionValue | undefined {
  if (!/^[\w-]+$/u.test(text)) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null) return undefined;
    const cursor = value as Partial<HubCursor>;
    if (cursor.inputHash !== inputHash || typeof cursor.after !== 'object' || cursor.after === null) return undefined;
    const after = cursor.after as SearchPositionValue;
    if (typeof after.path !== 'string' || !Number.isSafeInteger(after.line) || after.line < 0) return undefined;
    return { path: after.path, line: after.line };
  } catch {
    return undefined;
  }
}

function warningKind(reason: SkipReason): FsGrepWarningKind | undefined {
  switch (reason) {
    case SkipReason.BINARY: return 'binary';
    case SkipReason.NOT_UTF8: return 'invalid_utf8';
    case SkipReason.TOO_LARGE: return 'oversized';
    case SkipReason.UNREADABLE: return 'unreadable';
    case SkipReason.SYMLINK: return 'link';
    case SkipReason.IGNORED:
    case SkipReason.UNSPECIFIED: return undefined;
    default: return undefined;
  }
}
function searchFailureType(reason: FileFailureReason): Extract<FsGrepResult, { status: 'error' }>['type'] {
  switch (reason) {
    case FileFailureReason.NOT_FOUND: return 'not_found';
    case FileFailureReason.WRONG_KIND: return 'not_regular_file';
    case FileFailureReason.NOT_UTF8: return 'invalid_utf8';
    case FileFailureReason.ALREADY_EXISTS: return 'file_exists';
    case FileFailureReason.TEXT_NOT_FOUND: return 'old_text_not_found';
    case FileFailureReason.TEXT_AMBIGUOUS: return 'old_text_ambiguous';
    case FileFailureReason.OUTCOME_UNKNOWN: return 'outcome_unknown';
    case FileFailureReason.DIRECTORY_TOO_LARGE: return 'directory_too_large';
    case FileFailureReason.FILE_TOO_LARGE: return 'representation_too_large';
    case FileFailureReason.IO:
    case FileFailureReason.UNSPECIFIED: return 'invalid_path';
    default: return 'invalid_path';
  }
}

function groupsFrom(matches: readonly MatchEvent[]): PassageGroup[] {
  const groups: PassageGroup[] = [];
  let current: PassageGroup | undefined;
  for (const match of matches) {
    const first = match.lines[0]?.number ?? match.line;
    const last = match.lines.at(-1)?.number ?? match.line;
    if (current === undefined || current.path !== match.path || first > current.endLine + 1) {
      current = { path: match.path, startLine: first, endLine: last, lines: new Map(), matches: [] };
      groups.push(current);
    }
    current.startLine = Math.min(current.startLine, first);
    current.endLine = Math.max(current.endLine, last);
    for (const line of match.lines) current.lines.set(line.number, line.text);
    current.matches.push(match.line);
  }
  return groups;
}

function numbered(group: PassageGroup, from = group.startLine, to = group.endLine): string {
  const lines: string[] = [];
  for (let line = from; line <= to; line += 1) {
    const text = group.lines.get(line);
    if (text !== undefined) {
      const shown = text.length > GREP_LIMITS.lineCodeUnits ? `${text.slice(0, GREP_LIMITS.lineCodeUnits)}…` : text;
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

function encodeSearchRequest(params: FsGrepParams, after?: SearchPositionValue) {
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
      ...(params.bounds.bytes !== null && { bytes: BigInt(params.bounds.bytes) }),
      ...(params.bounds.fileBytes !== null && { fileBytes: BigInt(params.bounds.fileBytes) }),
      ...(params.bounds.limit > 0 && { matches: params.bounds.limit }),
    },
  });
}

function continuationUnits(cursor: HubCursor): number {
  return `[more results. Continue with cursor: ${cursorEncode(cursor)}]`.length + 1;
}
function pageGroups(groups: PassageGroup[], cappedGroups: ReadonlySet<PassageGroup>, params: FsGrepParams, inputHash: string, daemonHasMore: boolean): { results: FsGrepPassage[]; cursor?: string } {
  const results: FsGrepPassage[] = [];
  let previous: FsGrepPassage | undefined;
  let cursor: string | undefined;
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (group === undefined) continue;
    const hasMore = index + 1 < groups.length || daemonHasMore;
    const capped = cappedGroups.has(group);
    let passage = asNativePassage(group);
    const previousNative = previous === undefined ? undefined : {
      locator: `${previous.path}:L${previous.startLine}-${previous.endLine}`,
      content: previous.content,
      matches: previous.matches,
    };
    const units = grepPassageUnits(previousNative, passage);
    const nextPoint = { after: { path: group.path, line: group.endLine }, inputHash };
    if (units + (hasMore ? continuationUnits(nextPoint) : 0) > params.bounds.pageUnits) {
      if (results.length > 0 && previous !== undefined) {
        cursor = cursorEncode({ after: { path: previous.path, line: previous.endLine }, inputHash });
        break;
      }
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
        if (grepPassageUnits(undefined, candidate) + continuationUnits({ after: { path: group.path, line: end }, inputHash }) > params.bounds.pageUnits) break;
        fitting = lineCount;
      }
      fitting = Math.max(1, fitting);
      const end = Math.min(group.endLine, group.startLine + fitting - 1);
      passage = {
        ...passage,
        locator: `${group.path}:L${group.startLine}-${end}`,
        content: lines.slice(0, fitting).join('\n'),
        matches: group.matches.filter((line) => line <= end),
        cut: true,
      };
      results.push(toResultPassage(passage, capped));
      cursor = cursorEncode({ after: { path: group.path, line: end }, inputHash });
      break;
    }
    previous = toResultPassage(passage, capped);
    results.push(previous);
  }
  return { results, ...(cursor && { cursor }) };
}

export const searchHandlers: Partial<Record<'fs.grep', Handler<'fs.grep'>>> = {
  'fs.grep': async (session: MachineSession, params: FsGrepParams, options?: MachineRequestOptions): Promise<FsGrepResult> => {
    const inputHash = fsGrepCursorKey(params);
    const after = params.cursor === undefined ? undefined : cursorDecode(params.cursor, inputHash);
    if (params.cursor !== undefined && after === undefined) {
      return { status: 'error', type: 'invalid_input', message: 'The grep cursor is invalid or belongs to different search inputs.' };
    }

    const stream = session.clients.files.searchFiles(
      encodeSearchRequest(params, after),
      session.callOptions({ ...options, envelope: options?.envelope ?? params.envelope }),
    );
    const matches: MatchEvent[] = [];
    const warningCounts = new Map<FsGrepWarningKind, number>();
    const ignoredPaths: string[] = [];
    let ignoredAtLeast = false;
    let end: SearchEnd | undefined;
    try {
      for await (const response of stream) {
        switch (response.event.case) {
          case 'match': matches.push(response.event.value); break;
          case 'skipped': {
            const kind = warningKind(response.event.value.reason);
            if (kind !== undefined) warningCounts.set(kind, (warningCounts.get(kind) ?? 0) + 1);
            else if (response.event.value.reason === SkipReason.IGNORED) {
              if (ignoredPaths.length < GREP_LIMITS.ignoredLocators) ignoredPaths.push(response.event.value.path);
            }
            break;
          }
          case 'end': end = response.event.value; break;
          case 'failure': return { status: 'error', type: searchFailureType(response.event.value.reason), message: response.event.value.message };
          case undefined: break;
        }
      }
    } catch (error) {
      throw session.mapRefusal(error);
    }
    const grouped = groupsFrom(matches);
    const countsByFile = new Map<string, number>();
    for (const group of grouped) countsByFile.set(group.path, (countsByFile.get(group.path) ?? 0) + 1);
    const limitedGroups: PassageGroup[] = [];
    const cappedGroups = new Set<PassageGroup>();
    const emittedByFile = new Map<string, number>();
    for (const group of grouped) {
      const filePassages = emittedByFile.get(group.path) ?? 0;
      if (filePassages === 20) continue;
      emittedByFile.set(group.path, filePassages + 1);
      limitedGroups.push(group);
      if (filePassages === 19 && (countsByFile.get(group.path) ?? 0) > 20) cappedGroups.add(group);
    }
    const daemonPosition = end?.position;
    const page = pageGroups(limitedGroups, cappedGroups, params, inputHash, end?.stop !== SearchStop.COMPLETE && daemonPosition !== undefined);
    const complete = end?.stop === SearchStop.COMPLETE && page.cursor === undefined;
    const cursor = page.cursor ?? (!complete && daemonPosition ? cursorEncode({ after: daemonPosition, inputHash }) : undefined);
    const warnings = [...warningCounts].map(([kind, count]) => ({ kind, count }));
    const progressed = params.bounds.progressed || (end?.files ?? 0) > 0;
    return {
      ok: true,
      results: page.results,
      complete,
      ...(cursor && { cursor }),
      warnings,
      consumed: { files: end?.files ?? 0, entries: end?.files ?? 0, bytes: Number(end?.bytes ?? 0n) },
      progressed,
      ...(!complete && !progressed && daemonPosition && { unfinished: daemonPosition.path }),
      ...(ignoredPaths.length > 0 || ignoredAtLeast ? { ignored: { paths: ignoredPaths, atLeast: ignoredAtLeast } } : {}),
    };
  },
};
