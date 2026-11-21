/**
 * The answers a Machine daemon gives the `machine://` native tools, as the
 * shapes the tools store: every path a Machine operation reports becomes a
 * canonical Machine locator, and an `fs.edit` or `fs.write` success maps to
 * the mutation result its display and status line name.
 */

import {
  type JsonValue,
  type NativeLineRange,
  type NativeMutationDisplay,
  type NativeMutationResult,
} from '@workspace/machine-protocol';
import {
  formatMachineLocator,
  machinePrefix,
  type MachineLocator,
} from '../machines/machine-locator';
import { readNativeFailure } from '../machines/machine-results';
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import { type ToolResult } from './types';

/** One `machine://` locator naming an absolute path on its Machine. */
export type MachinePath = Extract<MachineLocator, { kind: 'path' }>;

/** The locator a Machine path reports, spelled the way the hub asked for it. */
export function machinePathLocator(machine: MachinePath): string {
  return (
    formatMachineLocator(machine.name, machine.path) ??
    `${machinePrefix(machine.name)}${machine.path}`
  );
}

/**
 * The path a Machine result reported, re-encoded once. The daemon concatenates
 * its display prefix onto the raw absolute path, so a filename containing `#`
 * arrives unescaped; re-encoding here is what makes the reported locator
 * round-trip. A path that does not carry this Machine's prefix is not a locator
 * this hub asked for and is dropped rather than reported.
 */
function canonicalReportedPath(
  name: string,
  value: unknown,
): string | undefined {
  if (!isString(value)) return undefined;
  const prefix = machinePrefix(name);

  if (!value.startsWith(prefix)) return undefined;

  return formatMachineLocator(name, value.slice(prefix.length)) ?? undefined;
}

/**
 * Every path a Machine operation reports is a canonical Machine locator. A
 * directory read also carries its header inside `content`, which is the display
 * path the daemon rendered, so that one occurrence is re-encoded too; file
 * content is never rewritten.
 */
export function canonicalizeMachineResult(
  machine: MachinePath,
  result: ToolResult,
): ToolResult {
  if (result.status !== 'success') return result;
  const path = canonicalReportedPath(machine.name, result['path']);
  const realPath = canonicalReportedPath(machine.name, result['realPath']);

  const canonical: ToolResult = {
    ...result,
    path: path ?? machinePathLocator(machine),
    ...(realPath !== undefined && { realPath }),
  };

  const content = result['content'];
  const reportedPath = canonical['path'];

  if (
    result['kind'] !== 'directory' ||
    !isString(content) ||
    !isString(reportedPath)
  )
    return canonical;
  const header = `${machinePrefix(machine.name)}${machine.path}`;

  return {
    ...canonical,
    content: content.split(header).join(reportedPath),
  };
}

/** One stored line range from a daemon answer: both counts, or nothing. */
function readMutationRange(value: unknown): NativeLineRange | undefined {
  if (!isRecord(value)) return undefined;
  const { startLine, endLine } = value;

  return isNumber(startLine) && isNumber(endLine)
    ? { startLine, endLine }
    : undefined;
}

/** The edit input a Machine edit call carries. */
export type MachineEditInput = {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
};

/** The display data of an edit answer: the daemon's start line with the text
 *  the hub already holds. A daemon answers without the replaced and
 *  replacement text, because echoing a large replacement would carry it over
 *  the frame limit twice and can fail after the file has changed, so the
 *  stored part takes `oldText` and `newText` from the call, exactly as a local
 *  edit takes them from its input. */
function readMutationDisplay(
  value: unknown,
  input: MachineEditInput,
): NativeMutationDisplay | undefined {
  if (!isRecord(value)) return undefined;
  const { startLine } = value;

  return isNumber(startLine)
    ? { startLine, oldText: input.oldText, newText: input.newText }
    : undefined;
}

/** One `fs.write` success: only the facts its status line names. An old
 *  daemon's `content`, `shownRange`, and `truncated` belong to the edit form
 *  and would contradict the write contract, so they are dropped, never
 *  stored. */
function readFsWriteResult(
  value: UnknownRecord,
  path: string,
): NativeMutationResult {
  const { created, replaced, lineCount } = value;

  return {
    status: 'success',
    operation: 'write',
    path,
    ...(created === true && { created: true }),
    ...(replaced === true && { replaced: true }),
    ...(isNumber(lineCount) && { lineCount }),
  };
}

/** One `fs.edit` success: its numbered region, shown range, cut marker, line
 *  count, and display data. An old-daemon edit without display data keeps its
 *  `diff`, which is the only line numbering the owner UI has for such a part;
 *  a current answer's display data makes the diff dead weight. Each field is
 *  forwarded only when it is well formed. */
function readFsEditResult(
  value: UnknownRecord,
  path: string,
  input: MachineEditInput | undefined,
): NativeMutationResult {
  const { content, truncated, cut, replacements, lineCount } = value;
  const storedRange = value['shownRange'];

  const shownRange =
    storedRange === null ? null : readMutationRange(storedRange);

  const display =
    input === undefined
      ? undefined
      : readMutationDisplay(value['display'], input);

  const legacyDiff =
    display === undefined && isString(value['diff'])
      ? value['diff']
      : undefined;

  return {
    status: 'success',
    operation: 'edit',
    path,
    ...(replacements === 1 && { replacements: 1 }),
    ...(isString(content) && { content }),
    ...(shownRange !== undefined && { shownRange }),
    ...(isBoolean(truncated) && { truncated }),
    ...(cut === true && { cut: true }),
    ...(isNumber(lineCount) && { lineCount }),
    ...(display !== undefined && { display }),
    ...(legacyDiff !== undefined && { diff: legacyDiff }),
  };
}

/**
 * One `fs.edit` or `fs.write` success, mapped to the shape the tool stores. A
 * write is status only; an edit carries its region and the display data the
 * owner UI diffs. A daemon that predates a field still yields a usable result.
 */
export function readFsMutateResult(
  value: JsonValue,
  editInput: MachineEditInput | undefined,
): ToolResult | undefined {
  const failure = readNativeFailure(value);

  if (failure !== undefined) return failure;

  if (!isRecord(value) || value['status'] !== 'success') return undefined;
  const { operation, path } = value;

  if ((operation !== 'edit' && operation !== 'write') || !isString(path))
    return undefined;

  return operation === 'write'
    ? readFsWriteResult(value, path)
    : readFsEditResult(value, path, editInput);
}
