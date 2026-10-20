/**
 * The remote side of an `ssh://` operation (ssh-locator design D4, D5): the
 * script that travels on stdin, the per-call nonce that frames its output, and
 * the parsers that read the frame back.
 *
 * The script is one `{ …; }` group, so the remote shell parses all of it before
 * it runs anything, and its only arguments are single-quoted values this
 * module writes — no model text reaches the remote argv. Every call draws a new
 * nonce:
 *
 * - `<nonce>:start[:file|:dir]` on stdout, `<nonce>:start` on stderr, once the
 *   preconditions hold. The hub discards everything before the stdout marker,
 *   so login-shell startup output is neither content nor a counted byte.
 * - `<nonce>:refuse:<kind>` instead of the marker when a precondition fails.
 * - `<nonce>:end:<status>` on stderr at exit. Until it arrives the operation is
 *   incomplete, whatever else the streams hold.
 */

import { randomBytes } from 'node:crypto';

/** The 1 MiB file bound; the transfer asks for one byte more to see it. */
export const SSH_READ_MAX_BYTES = 1024 * 1024;

/** The bytes a regular-file read asks the host for: the bound plus one. */
export const SSH_READ_TRANSFER_BYTES = SSH_READ_MAX_BYTES + 1;

/** The entries a directory list keeps, and the one more that says there are more. */
export const SSH_LIST_MAX_ENTRIES = 1000;

/** Room for the marker, the login-shell noise before it, and the trailer. */
export const SSH_READ_NOISE_BYTES = 64 * 1024;

/**
 * The preconditions a read can fail before its marker. `unreadable` is the
 * local "could not be read" result, `not_regular_file` a FIFO, socket, or
 * device that is never opened.
 */
export type SshReadRefusal = 'not_found' | 'not_regular_file' | 'unreadable';

const READ_REFUSALS: ReadonlyArray<SshReadRefusal> = [
  'not_found',
  'not_regular_file',
  'unreadable',
];

/**
 * A refusal kind this revision understands. The host writes the kind as text,
 * so a script from another revision reaches the hub as an unknown one rather
 * than as a different refusal.
 */
export function isSshReadRefusal(value: string): value is SshReadRefusal {
  return READ_REFUSALS.some((kind) => kind === value);
}

/** What the stdout marker says the rest of stdout holds. */
export type SshReadKind = 'file' | 'dir';

/** The frames one read's streams carry. */
export type SshReadFrames = {
  /** True once the stdout start marker arrived; nothing before it is content. */
  readonly started: boolean;
  /** Whether the marker said content or a directory listing, when it said either. */
  readonly kind?: SshReadKind;
  /** The bytes after the marker line; empty when the marker did not arrive. */
  readonly content: Buffer;
  /** The refusal kind, exactly as the host wrote it, when a precondition failed. */
  readonly refusal?: string;
  /** The status of the end trailer; absent when the trailer did not arrive. */
  readonly status?: number;
};

/** One entry of a directory listing the host sent. */
export type SshDirectoryEntry = {
  readonly name: string;
  readonly kind: 'directory' | 'file' | 'symlink' | 'special';
};

/** A fresh per-call marker: 16 random bytes, so no model text can guess it. */
export function createSshNonce(): string {
  return randomBytes(16).toString('hex');
}

/** One shell word: single quotes, with an embedded quote escaped `'\''`. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/** The stdout/stderr start marker; the hub discards every byte before it. */
export function sshStartMarker(nonce: string): string {
  return `${nonce}:start`;
}

/** The refusal function and the one precondition every read shares. */
function preconditionLines(nonce: string, path: string): Array<string> {
  return [
    `  h=${nonce}`,
    `  p=${path}`,
    '  refuse() {',
    String.raw`    printf '%s:refuse:%s\n' "$h" "$1" >&2`,
    String.raw`    printf '%s:end:0\n' "$h" >&2`,
    '    exit 0',
    '  }',
    '  if [ ! -e "$p" ]; then refuse not_found; fi',
  ];
}

/** The directory branch: one NUL-terminated `type`/`name` pair per entry. */
function directoryLines(): Array<string> {
  const limit = String(SSH_LIST_MAX_ENTRIES + 1);
  return [
    '  if [ -d "$p" ]; then',
    '    if [ ! -r "$p" ] || [ ! -x "$p" ]; then refuse unreadable; fi',
    String.raw`    printf '%s:start:dir\n' "$h"`,
    String.raw`    printf '%s:start\n' "$h" >&2`,
    '    n=0',
    '    for e in "$p"/* "$p"/.[!.]* "$p"/..?*; do',
    '      if [ ! -e "$e" ] && [ ! -L "$e" ]; then continue; fi',
    '      if [ -L "$e" ]; then k=l',
    '      elif [ -d "$e" ]; then k=d',
    '      elif [ -f "$e" ]; then k=f',
    '      else k=o',
    '      fi',
    '      name=${e##*/}',
    String.raw`      printf '%s\000%s\000' "$k" "$name"`,
    '      n=$((n + 1))',
    `      if [ "$n" -ge ${limit} ]; then break; fi`,
    '    done',
  ];
}

/** The file branch: one stat check per refusal, then the bounded transfer. */
function fileLines(): Array<string> {
  return [
    '  else',
    '    if [ ! -f "$p" ]; then refuse not_regular_file; fi',
    '    if [ ! -r "$p" ]; then refuse unreadable; fi',
    String.raw`    printf '%s:start:file\n' "$h"`,
    String.raw`    printf '%s:start\n' "$h" >&2`,
    `    head -c ${String(SSH_READ_TRANSFER_BYTES)} -- "$p"`,
  ];
}

/**
 * The read script: preconditions first, then either the refusal frame or the
 * start markers and the work, then the end trailer. The stdout marker says
 * whether the bytes after it are file content or a directory listing.
 */
export function buildSshReadScript(request: {
  readonly nonce: string;
  readonly path: string;
}): string {
  return [
    '{',
    ...preconditionLines(shellQuote(request.nonce), shellQuote(request.path)),
    ...directoryLines(),
    ...fileLines(),
    '  fi',
    '  s=$?',
    String.raw`  printf '%s:end:%s\n' "$h" "$s" >&2`,
    '}',
    '',
  ].join('\n');
}

/** The end trailer's status, from the last one `stderr` holds. */
export function parseSshTrailer(
  stderr: string,
  nonce: string,
): number | undefined {
  const marker = `${nonce}:end:`;
  const index = stderr.lastIndexOf(marker);
  if (index === -1) return undefined;
  const digits = /^[0-9]{1,3}/u.exec(stderr.slice(index + marker.length))?.[0];
  return digits === undefined ? undefined : Number(digits);
}

/** The refusal kind, when the host refused a precondition. */
export function parseSshRefusal(
  stderr: string,
  nonce: string,
): string | undefined {
  const marker = `${nonce}:refuse:`;
  const index = stderr.indexOf(marker);
  if (index === -1) return undefined;
  const rest = stderr.slice(index + marker.length);
  const end = rest.search(/[\r\n]/u);
  return end === -1 ? rest : rest.slice(0, end);
}

/** The kind a marker suffix names; a suffix from another revision is unknown. */
function markerKind(suffix: string): SshReadKind | undefined {
  if (suffix === '' || suffix === ':file') return 'file';
  return suffix === ':dir' ? 'dir' : undefined;
}

/**
 * Split one read's streams into its frames. The stdout marker is a line of its
 * own, so a marker-shaped string inside file content (which needs the nonce to
 * be shaped at all) cannot be it: the first one that ends its line wins.
 */
export function parseSshReadFrames(
  stdout: Buffer,
  stderr: string,
  nonce: string,
): SshReadFrames {
  const marker = Buffer.from(sshStartMarker(nonce));
  const index = stdout.indexOf(marker);
  const refusal = parseSshRefusal(stderr, nonce);
  if (index === -1)
    return {
      // A process that failed before it closed (a deadline, a cancellation)
      // carries no stdout, but the stderr marker still says the script started:
      // the read began and cannot be completed, which is the verdict the caller
      // needs. No status is reported from this branch for the same reason.
      started: stderr.includes(marker.toString('latin1')),
      content: Buffer.alloc(0),
      ...(refusal !== undefined && { refusal }),
    };
  const lineEnd = stdout.indexOf(0x0a, index + marker.length);
  const suffix = stdout
    .subarray(index + marker.length, lineEnd === -1 ? undefined : lineEnd)
    .toString('latin1');
  const kind = markerKind(suffix);
  const status = parseSshTrailer(stderr, nonce);
  return {
    started: true,
    ...(kind !== undefined && { kind }),
    content: lineEnd === -1 ? Buffer.alloc(0) : stdout.subarray(lineEnd + 1),
    ...(status !== undefined && { status }),
  };
}

/** The entry kind a type letter names; an unknown letter is skipped. */
function entryKind(letter: string): SshDirectoryEntry['kind'] | undefined {
  switch (letter) {
    case 'd':
      return 'directory';
    case 'f':
      return 'file';
    case 'l':
      return 'symlink';
    case 'o':
      return 'special';
    default:
      return undefined;
  }
}

/**
 * The host's `<type>\0<name>\0` pairs. NUL termination is what keeps a name
 * with a newline one entry, and the transfer stops one entry past the bound so
 * the caller learns there are more.
 */
export function parseSshDirectoryEntries(content: Buffer): {
  readonly entries: ReadonlyArray<SshDirectoryEntry>;
  readonly more: boolean;
} {
  const fields = content.toString('utf8').split('\0');
  const entries: Array<SshDirectoryEntry> = [];
  // The last field is the empty string after the final NUL.
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const kind = entryKind(fields[index]);
    if (kind === undefined) continue;
    entries.push({ name: fields[index + 1], kind });
  }
  return entries.length > SSH_LIST_MAX_ENTRIES
    ? { entries: entries.slice(0, SSH_LIST_MAX_ENTRIES), more: true }
    : { entries, more: false };
}
