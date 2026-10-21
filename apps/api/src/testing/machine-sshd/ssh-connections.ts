/**
 * The `ssh://` side of the sshd fixture (ssh-locator task 4.1): the operator
 * SSH configuration a read includes, the pinned known_hosts variants, and the
 * plain-login key both the box and the bastion accept. It is separate from
 * `machine-sshd.ts` so each file states one side of the fixture — the Machine
 * route and its forced command, and the plain login an `ssh://` call uses.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The three files one `ssh://` client is pointed at. */
export type SshdSshConnection = {
  readonly knownHostsFile: string;
  readonly includeFile: string;
  readonly identityFile: string;
};

/** Which host key and identity the `ssh://` files hold. */
export type SshConnectionVariant = {
  /** Keep the box's own key in the pinned file (the default). */
  readonly pinBox?: boolean;
  /** Include the configuration that tries to weaken checking. */
  readonly weaken?: boolean;
  /** The identity the include names; the fixture's plain key by default. */
  readonly identityFile?: string;
};

/** The host names the include declares and the known_hosts lines use. */
export type SshFixtureHosts = {
  readonly box: string;
  readonly bastion: string;
  readonly shBox: string;
};

/** Everything one `ssh://` connection file set is built from. */
export type SshFixtureFiles = {
  readonly directory: string;
  readonly controlDirectory: string;
  readonly plainKeyFile: string;
  readonly bastionPort: number;
  readonly shBoxPort: number;
  /** `<name> <key>` known_hosts lines, one per container. */
  readonly hostKeys: SshFixtureHosts;
  readonly hosts: SshFixtureHosts;
};

/** One `Host` block with its indented options, and the blank line after it. */
function hostBlock(
  host: string,
  options: ReadonlyArray<string>,
): Array<string> {
  return [`Host ${host}`, ...options.map((option) => `  ${option}`), ''];
}

/** The included configuration's own attempt to weaken the safety block. */
function weakeningBlock(files: SshFixtureFiles): Array<string> {
  return hostBlock('*', [
    '# The suite attempts to weaken the safety block; ssh keeps the first',
    '# value it obtains, so none of these may reach a connection.',
    'StrictHostKeyChecking accept-new',
    'ControlMaster auto',
    `ControlPath ${join(files.controlDirectory, '%C')}`,
  ]);
}

/**
 * The operator configuration an `ssh://` client includes: the box through the
 * bastion, the `sh`-only box directly, and, for the weakening variant, one
 * trailing `Host *` block.
 */
function includeConfigText(
  files: SshFixtureFiles,
  variant: SshConnectionVariant,
): string {
  const identity = variant.identityFile ?? files.plainKeyFile;
  const weakening = variant.weaken === true ? weakeningBlock(files) : [];
  return [
    '# Included by the generated ssh:// SSH configuration.',
    ...hostBlock(files.hosts.box, [
      `HostName ${files.hosts.box}`,
      'User box',
      'Port 22',
      `IdentityFile ${identity}`,
      `ProxyJump ${files.hosts.bastion}`,
      `HostKeyAlias ${files.hosts.box}`,
    ]),
    ...hostBlock(files.hosts.bastion, [
      'HostName 127.0.0.1',
      `Port ${String(files.bastionPort)}`,
      'User box',
      `IdentityFile ${identity}`,
      `HostKeyAlias ${files.hosts.bastion}`,
    ]),
    ...hostBlock(files.hosts.shBox, [
      'HostName 127.0.0.1',
      `Port ${String(files.shBoxPort)}`,
      'User box',
      `IdentityFile ${identity}`,
      `HostKeyAlias ${files.hosts.shBox}`,
    ]),
    ...weakening,
  ].join('\n');
}

/** One `ssh://` connection file set; both hosts and the bastion are pinned. */
function createSshConnection(
  files: SshFixtureFiles,
  index: number,
  variant: SshConnectionVariant,
): SshdSshConnection {
  const pinned = [
    files.hostKeys.bastion,
    files.hostKeys.shBox,
    ...(variant.pinBox === false ? [] : [files.hostKeys.box]),
  ];
  const knownHostsFile = join(files.directory, `ssh_known_hosts-${index}`);
  writeFileSync(knownHostsFile, `${pinned.join('\n')}\n`, 'utf8');
  const includeFile = join(files.directory, `ssh_config_ssh-${index}`);
  writeFileSync(includeFile, includeConfigText(files, variant), 'utf8');
  return {
    knownHostsFile,
    includeFile,
    identityFile: variant.identityFile ?? files.plainKeyFile,
  };
}

/**
 * The connection one option set names, built once per set: a suite asks for the
 * pinned files repeatedly, and each variant is its own known_hosts and include.
 */
export function sshConnection(
  cache: Map<string, SshdSshConnection>,
  files: SshFixtureFiles,
  options: SshConnectionVariant,
): SshdSshConnection {
  const key = JSON.stringify(options);
  const existing = cache.get(key);
  if (existing !== undefined) return existing;
  const created = createSshConnection(files, cache.size, options);
  cache.set(key, created);
  return created;
}
