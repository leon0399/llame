/**
 * The `ssh://` locator grammar (ssh-locator spec "ssh locators name a
 * destination with strict spelling", "ssh locator users and ports have a strict
 * form", "ssh locator paths are absolute and decoded one time", and "A bare ssh
 * locator tells how to address hosts"). Pure: no filesystem, no configuration,
 * no SSH — the tool layer, the permission admission, and result rendering all
 * go through this one grammar, so a destination has exactly one accepted
 * spelling and model text never reaches an `ssh` option or an ssh_config
 * `%h`/`%u` expansion.
 *
 * Grammar:
 *
 *   ssh://                     how to address hosts (fixed message)
 *   ssh:///                    the same fixed message
 *   ssh://[user@]host[:port]/<path>[:selector]
 *
 * The scheme is case-insensitive and canonicalizes to lowercase. A host is a
 * name or IPv4 literal of `[A-Za-z0-9._-]` not starting with `-`, or a
 * bracketed IPv6 literal of hex digits, `:`, and `.` with no zone. A user is
 * `[A-Za-z0-9._-]` not starting with `-`. A port is 1 to 65535. The path is
 * absolute, follows the `machine://`/`file:` decoding rules, and the read
 * selector splits off the raw text before the path decodes once.
 */

import {
  isSelectorSuffix,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';

import { decodeFileAlias } from '../tools/permissions/file-alias';
import { encodeLocatorPath } from '../tools/permissions/locator-path';

export const SSH_SCHEME = 'ssh';

const LOCATOR_PREFIX = /^ssh:\/\//iu;
const UNIX_NAME_PATTERN = /^[A-Za-z0-9._-]+$/u;
const IPV6_LITERAL_PATTERN = /^[0-9A-Fa-f:.]+$/u;

/** The fixed answer a bare `ssh://` read gives; it never lists hosts. */
export const SSH_LOCATOR_HELP =
  'An ssh:// locator names a destination that OpenSSH resolves through the ' +
  "operator's SSH configuration, written ssh://[user@]host[:port]/absolute/path. " +
  'Permissions select the destinations a Run may use; this tool does not list hosts.';

const BAD_PATH =
  'An ssh path must be absolute, and its percent escapes must decode once to ' +
  'UTF-8 without a literal query, fragment, backslash, or control character, ' +
  'and without encoding a path separator or NUL.';

const BAD_USER =
  'An ssh user must match [A-Za-z0-9._-] and must not begin with "-".';

const BAD_HOST =
  'An ssh host must be a name or IPv4 literal of [A-Za-z0-9._-] that does not ' +
  'begin with "-", or a bracketed IPv6 literal of hex digits, ":", and "." ' +
  'with no zone.';

const BAD_PORT = 'An ssh port must be a number from 1 to 65535.';

const BAD_PASSWORD =
  'An ssh:// locator does not accept a password; write only [user@]host.';

/** The submitted destination: a host, with the user and port when written. */
export type SshDestination = {
  /** The host, unbracketed and lowercased; an IPv6 literal keeps its colons. */
  readonly host: string;
  readonly user?: string;
  readonly port?: number;
};

/** A parsed `ssh://` destination and absolute path. */
export type SshPathLocator = {
  readonly kind: 'path';
  readonly destination: SshDestination;
  /** Decoded absolute path; `.`, `..`, and a trailing `/` are kept. */
  readonly path: string;
  /** Read selector exactly as written, when it has the shared shape. */
  readonly selector?: string;
};

/** A parsed `ssh://` locator, or the refusal that replaced it. */
export type SshLocator =
  | { readonly kind: 'help' }
  | SshPathLocator
  | { readonly kind: 'invalid'; readonly message: string };

/** Does this text claim the `ssh://` scheme, in any case? */
export function isSshLocator(value: string): boolean {
  return LOCATOR_PREFIX.test(value);
}

/** A parsed destination from an authority, or the refusal that replaced it. */
function parseSshAuthority(
  authority: string,
): SshDestination | { readonly message: string } {
  const at = authority.lastIndexOf('@');
  const user = at === -1 ? undefined : authority.slice(0, at);
  const hostPart = at === -1 ? authority : authority.slice(at + 1);
  if (user !== undefined) {
    if (user.includes(':')) return { message: BAD_PASSWORD };
    if (!UNIX_NAME_PATTERN.test(user) || user.startsWith('-'))
      return { message: BAD_USER };
  }
  if (hostPart.startsWith('[')) {
    const close = hostPart.indexOf(']');
    if (close === -1) return { message: BAD_HOST };
    const literal = hostPart.slice(1, close);
    const port = parseSshPort(hostPart.slice(close + 1));
    if ('message' in port) return port;
    if (!IPV6_LITERAL_PATTERN.test(literal) || !literal.includes(':'))
      return { message: BAD_HOST };
    return withOptional(
      { host: literal.toLowerCase(), ...(user !== undefined && { user }) },
      port.port,
    );
  }
  const colon = hostPart.lastIndexOf(':');
  const host = colon === -1 ? hostPart : hostPart.slice(0, colon);
  const port = parseSshPort(colon === -1 ? '' : hostPart.slice(colon));
  if ('message' in port) return port;
  if (!UNIX_NAME_PATTERN.test(host) || host.startsWith('-'))
    return { message: BAD_HOST };
  return withOptional(
    { host: host.toLowerCase(), ...(user !== undefined && { user }) },
    port.port,
  );
}

/**
 * A port suffix is `""` (written at all) or `:<digits>`. A written-but-empty
 * or out-of-range port is refused, so `ssh://box:/x` and `ssh://box:0/x` do
 * not fall back to 22.
 */
function parseSshPort(
  suffix: string,
): { readonly port?: number } | { readonly message: string } {
  if (suffix === '') return {};
  if (!suffix.startsWith(':')) return { message: BAD_PORT };
  const digits = suffix.slice(1);
  if (!/^[0-9]{1,5}$/u.test(digits)) return { message: BAD_PORT };
  const port = Number(digits);
  return port >= 1 && port <= 65_535 ? { port } : { message: BAD_PORT };
}

function withOptional(
  destination: SshDestination,
  port: number | undefined,
): SshDestination {
  return port === undefined ? destination : { ...destination, port };
}

/**
 * Parse an `ssh://` locator. Total and pure: a malformed locator is an
 * `invalid` result, never a throw, and nothing here resolves or connects.
 */
export function parseSshLocator(value: string): SshLocator {
  const match = LOCATOR_PREFIX.exec(value);
  if (match === null)
    return { kind: 'invalid', message: 'This path is not an ssh:// locator.' };
  const rest = value.slice(match[0].length);
  if (rest === '' || rest === '/') return { kind: 'help' };
  const separator = rest.indexOf('/');
  if (separator === -1)
    return {
      kind: 'invalid',
      message:
        'An ssh:// locator needs an absolute path after the destination, like ssh://box/etc/hostname.',
    };
  const authority = rest.slice(0, separator);
  if (authority === '')
    return {
      kind: 'invalid',
      message: 'An ssh:// locator must name a host.',
    };
  const destination = parseSshAuthority(authority);
  if ('message' in destination) return { kind: 'invalid', ...destination };
  const rawPath = rest.slice(separator);
  const split = splitSelectorSuffix(rawPath);
  const selector =
    split.selector !== undefined && isSelectorSuffix(split.selector)
      ? split.selector
      : undefined;
  const decoded = decodeSshPath(selector === undefined ? rawPath : split.path);
  if (!decoded.ok) return { kind: 'invalid', message: decoded.message };
  return selector === undefined
    ? { kind: 'path', destination, path: decoded.path }
    : { kind: 'path', destination, path: decoded.path, selector };
}

/** Decode one layer of `%XX` escapes through the shared `file:` alias decoder. */
function decodeSshPath(
  rawPath: string,
): { ok: true; path: string } | { ok: false; message: string } {
  // The `file://localhost` authority keeps the shared decoder's own grammar
  // (literal query/fragment/backslash refusals and the `%2F`/`%00` guards)
  // while this module keeps the ssh wording.
  const decoded = decodeFileAlias(`file://localhost${rawPath}`);
  return decoded.ok
    ? { ok: true, path: decoded.hostPath }
    : { ok: false, message: BAD_PATH };
}

/**
 * The canonical locator text for one destination and path: lowercase scheme
 * and host, a bracketed IPv6 literal, and the path decoded and re-encoded once
 * (so `%23` and `.` are the only spelling). Returns `undefined` when the parts
 * cannot be a canonical locator at all — a host outside the grammar, a
 * non-numeric user or port, a relative path, a NUL, or a selector that is not
 * a valid read selector.
 */
export function formatSshLocator(
  destination: SshDestination,
  path: string,
  selector?: string,
): string | undefined {
  const host = destination.host.toLowerCase();
  const ipv6 = host.includes(':');
  if (
    (ipv6 && !IPV6_LITERAL_PATTERN.test(host)) ||
    (!ipv6 && (!UNIX_NAME_PATTERN.test(host) || host.startsWith('-')))
  )
    return undefined;
  if (
    destination.user !== undefined &&
    (!UNIX_NAME_PATTERN.test(destination.user) ||
      destination.user.startsWith('-'))
  )
    return undefined;
  if (
    destination.port !== undefined &&
    (!Number.isInteger(destination.port) ||
      destination.port < 1 ||
      destination.port > 65_535)
  )
    return undefined;
  if (selector !== undefined && !isSelectorSuffix(selector)) return undefined;
  const encoded = encodeLocatorPath(path);
  if (encoded === undefined) return undefined;
  const user = destination.user === undefined ? '' : `${destination.user}@`;
  const hostText = ipv6 ? `[${host}]` : host;
  const port =
    destination.port === undefined ? '' : `:${String(destination.port)}`;
  const locator = `${SSH_SCHEME}://${user}${hostText}${port}${encoded}`;
  return selector === undefined ? locator : `${locator}:${selector}`;
}
