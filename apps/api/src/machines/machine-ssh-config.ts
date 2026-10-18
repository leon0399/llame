/**
 * The generated SSH configuration every Machine connection goes through
 * (remote-machines design D1). Command-line `-o`/`-i` options apply to the
 * destination only — a jump host ignores them — so the safety options are
 * written into a private configuration file whose `Host *` block comes FIRST
 * and whose `Include` of the operator's own file comes last: ssh keeps the
 * first value it obtains, so host-key checking, batch mode, the agent, and
 * connection sharing are llame's for every hop, while aliases, `HostName`,
 * `User`, `Port`, `ProxyJump`/`ProxyCommand`, and identities still come from
 * the include.
 *
 * The file is written once per process, 0600, inside a private 0700 temp
 * directory, because it names the pinned host-key file and the llame identity.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/** The include's default: the worker user's own SSH configuration. */
export function defaultMachineSshConfigFile(): string {
  return join(homedir(), '.ssh', 'config');
}

export type MachineSshSafetyOptions = {
  /** The pinned host keys every hop is checked against. */
  readonly knownHostsFile: string;
  /** llame's own identity, when the operator configured one. */
  readonly identityFile?: string;
  /** The operator's SSH configuration, whose aliases and hops are kept. */
  readonly includeFile: string;
};

export type MachineSshConfigFile = {
  /** The absolute path passed to `ssh -F`. */
  readonly path: string;
  /** The generated text, so an operator page or a log can show it. */
  readonly text: string;
  /** Remove the private directory and the file. */
  readonly dispose: () => void;
};

const HEADER = [
  '# llame Machines (remote-machines D1): the safety block below wins for every',
  '# hop, including jump hosts, because ssh keeps the first value it obtains.',
  '# The included configuration supplies aliases, jump hosts, users, ports, and',
  '# identities; it cannot weaken these options.',
];

/**
 * The safety block: host keys only from the pinned file, strict checking, batch
 * mode, no agent, no connection sharing, and bounded connect/liveness timeouts.
 */
function safetyBlock(options: MachineSshSafetyOptions): ReadonlyArray<string> {
  const lines = [
    'Host *',
    `  UserKnownHostsFile ${quote(options.knownHostsFile)}`,
    '  GlobalKnownHostsFile none',
    '  StrictHostKeyChecking yes',
    '  BatchMode yes',
    '  IdentityAgent none',
    '  ForwardAgent no',
    '  ForwardX11 no',
    '  ControlMaster no',
    '  ControlPath none',
    '  PermitLocalCommand no',
    '  UpdateHostKeys no',
    '  ConnectTimeout 10',
    '  ServerAliveInterval 15',
    '  ServerAliveCountMax 3',
  ];
  if (options.identityFile !== undefined)
    lines.push(`  IdentityFile ${quote(options.identityFile)}`);
  return lines;
}

const BACKSLASH = '\u005c';
const ESCAPED_BACKSLASH = '\u005c\u005c';
const ESCAPED_QUOTE = '\u005c"';

/** Quote an ssh_config argument so a path containing spaces survives. */
function quote(value: string): string {
  const escaped = value.replaceAll(BACKSLASH, ESCAPED_BACKSLASH).replaceAll('"', ESCAPED_QUOTE);
  return `"${escaped}"`;
}

/** The exact text of the generated configuration. */
export function renderMachineSshConfig(options: MachineSshSafetyOptions): string {
  return [
    ...HEADER,
    ...safetyBlock(options),
    `Include ${quote(options.includeFile)}`,
    '',
  ].join('\n');
}

/**
 * Write the generated configuration into a private per-process directory.
 * `ssh -F` is given this absolute path, so no shell quoting and no `~` expansion
 * is involved, and a jump host inherits it (the implicit jump command carries
 * `-F`).
 */
export function createMachineSshConfigFile(
  options: MachineSshSafetyOptions,
): MachineSshConfigFile {
  const directory = mkdtempSync(join(tmpdir(), 'llame-machines-'), {
    encoding: 'utf8',
  });
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'ssh_config');
    const text = renderMachineSshConfig(options);
    writeFileSync(path, text, { encoding: 'utf8', mode: 0o600 });
    return { path, text, dispose: () => rmSync(directory, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
