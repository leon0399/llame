/**
 * The `machine://` locator grammar (remote-machines spec "Machine locators name
 * a configured Machine and an absolute path" and "Machine listings are
 * addressable"). Pure: no filesystem, no configuration, no SSH — the tool
 * layer, the permission projection, the Workspace binding, and result
 * rendering all go through this one grammar so a Machine address has exactly
 * one spelling.
 *
 * Grammar:
 *
 *   machine://                      every configured Machine (list)
 *   machine://<name>                that Machine's registered roots (roots)
 *   machine://<name>/<path>[:sel]   an absolute path on that Machine (path)
 *
 * The scheme and the name are case-insensitive and canonicalize to lowercase.
 * A read selector splits off BEFORE the path's percent-escapes decode once,
 * under the `file:` alias rules (`decodeFileAlias`), which is what makes a
 * reported locator for a file whose name contains `#` round-trip: the
 * formatter re-encodes exactly the characters the grammar requires.
 */

import {
  isSelectorSuffix,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';

import { decodeFileAlias } from '../tools/permissions/file-alias';

/** The locator scheme, and the prefix a Workspace executor id carries. */
export const MACHINE_SCHEME = 'machine';
export const MACHINE_EXECUTOR_PREFIX = 'machine:';

/** Machine names are the operator's configuration keys: lowercase and dashed. */
export const MACHINE_NAME_PATTERN = /^[a-z0-9-]{1,63}$/u;

const LOCATOR_PREFIX = /^machine:\/\//iu;
const NAME_SEPARATOR = '/';

/** A parsed `machine://` locator, or the refusal that replaced it. */
export type MachineLocator =
  | { readonly kind: 'list' }
  | { readonly kind: 'roots'; readonly name: string }
  | {
      readonly kind: 'path';
      readonly name: string;
      /** Decoded absolute Machine path; `.`, `..`, and trailing `/` kept. */
      readonly path: string;
      /** Read selector exactly as written, when it has the shared shape. */
      readonly selector?: string;
    }
  | { readonly kind: 'invalid'; readonly message: string };

const BAD_NAME =
  'A machine:// locator must name a Machine as [a-z0-9-], up to 63 characters.';
const BAD_PATH =
  'A Machine path must be absolute, and its percent escapes must decode once ' +
  'to UTF-8 without a literal query, fragment, backslash, or control ' +
  'character, and without encoding a path separator or NUL.';

/** Does this text claim the `machine://` scheme, in any case? */
export function isMachineLocator(value: string): boolean {
  return LOCATOR_PREFIX.test(value);
}

/**
 * Parse a `machine://` locator. Total and pure: a malformed locator is an
 * `invalid` result, never a throw. Whether the named Machine is *configured* is
 * the connector's answer (`isConfigured`), so a parse of `machine://nope/...`
 * still succeeds and the caller reports `machine_not_found` without SSH.
 */
export function parseMachineLocator(value: string): MachineLocator {
  const match = LOCATOR_PREFIX.exec(value);
  if (match === null)
    return {
      kind: 'invalid',
      message: 'This path is not a machine:// locator.',
    };
  const rest = value.slice(match[0].length);
  if (rest === '') return { kind: 'list' };
  const separator = rest.indexOf(NAME_SEPARATOR);
  const name = (
    separator === -1 ? rest : rest.slice(0, separator)
  ).toLowerCase();
  if (!MACHINE_NAME_PATTERN.test(name))
    return { kind: 'invalid', message: BAD_NAME };
  if (separator === -1) return { kind: 'roots', name };
  return parseMachinePath(name, rest.slice(separator));
}

/**
 * The path half of a locator: split the selector off the RAW text first (so a
 * percent-encoded colon can never smuggle a selector boundary past this step),
 * then decode the path once. A suffix that is not a valid read selector is not
 * a selector at all — it stays on the path, exactly as the local grammar
 * treats `notes:draft`.
 */
function parseMachinePath(name: string, rawPath: string): MachineLocator {
  const split = splitSelectorSuffix(rawPath);
  const selector =
    split.selector !== undefined && isSelectorSuffix(split.selector)
      ? split.selector
      : undefined;
  const decoded = decodeMachinePath(
    selector === undefined ? rawPath : split.path,
  );
  if (!decoded.ok) return { kind: 'invalid', message: decoded.message };
  return selector === undefined
    ? { kind: 'path', name, path: decoded.path }
    : { kind: 'path', name, path: decoded.path, selector };
}

/** Decode one layer of `%XX` escapes through the shared `file:` alias decoder. */
function decodeMachinePath(
  rawPath: string,
): { ok: true; path: string } | { ok: false; message: string } {
  // The `file://localhost` authority keeps the shared decoder's own grammar
  // (`//` authority handling, literal-query/fragment/backslash refusals, and
  // the `%2F`/`%00` guards) while this module keeps the Machine wording.
  const decoded = decodeFileAlias(`file://localhost${rawPath}`);
  return decoded.ok
    ? { ok: true, path: decoded.hostPath }
    : { ok: false, message: BAD_PATH };
}

/**
 * The canonical locator text for one Machine path, re-encoding only the
 * characters the grammar requires: `%` (so decoding stays one layer), the
 * reserved literals `#`, `?`, and `\`, control characters, and any `:` after
 * the last `/` (which the selector split would otherwise claim). Returns
 * `undefined` when the inputs cannot be a canonical locator at all — a name
 * outside the configuration grammar, a relative path, a NUL, or a selector
 * that is not a valid read selector.
 */
export function formatMachineLocator(
  name: string,
  path: string,
  selector?: string,
): string | undefined {
  const canonicalName = name.toLowerCase();
  if (!MACHINE_NAME_PATTERN.test(canonicalName)) return undefined;
  if (selector !== undefined && !isSelectorSuffix(selector)) return undefined;
  const encoded = encodeMachinePath(path);
  if (encoded === undefined) return undefined;
  const locator = `${MACHINE_SCHEME}://${canonicalName}${encoded}`;
  return selector === undefined ? locator : `${locator}:${selector}`;
}

function encodeMachinePath(path: string): string | undefined {
  if (!path.startsWith(NAME_SEPARATOR) || path.includes('\u0000'))
    return undefined;
  const lastSeparator = path.lastIndexOf(NAME_SEPARATOR);
  let encoded = '';
  for (let index = 0; index < path.length; index += 1) {
    encoded += encodePathCharacter(
      path.charCodeAt(index),
      index > lastSeparator,
    );
  }
  return encoded;
}

/** One character of a path, escaped only where the grammar requires it. */
function encodePathCharacter(
  code: number,
  afterLastSeparator: boolean,
): string {
  if (code === 0x25) return '%25';
  if (code === 0x23) return '%23';
  if (code === 0x3f) return '%3F';
  if (code === 0x5c) return '%5C';
  if (code === 0x3a && afterLastSeparator) return '%3A';
  if (code <= 0x1f || code === 0x7f)
    return `%${code.toString(16).padStart(2, '0').toUpperCase()}`;
  return String.fromCharCode(code);
}

/** The executor id a Machine Workspace binds: `machine:<name>`. */
export function machineExecutorId(name: string): string {
  return `${MACHINE_EXECUTOR_PREFIX}${name.toLowerCase()}`;
}

/** Does this text name a Machine executor (`machine:<name>`)? */
export function isMachineExecutorId(value: string): boolean {
  return parseMachineExecutorId(value) !== undefined;
}

/** The Machine a `machine:<name>` executor id names, or undefined. */
export function parseMachineExecutorId(value: string): string | undefined {
  if (!value.toLowerCase().startsWith(MACHINE_EXECUTOR_PREFIX))
    return undefined;
  const name = value.slice(MACHINE_EXECUTOR_PREFIX.length).toLowerCase();
  return MACHINE_NAME_PATTERN.test(name) ? name : undefined;
}
