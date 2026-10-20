/**
 * The Docker fixture behind `machine-ssh.integration.test.ts` (remote-machines
 * task 4.2): one sshd image built once and run twice on one network — as the
 * `bastion` jump host and as the box running the daemon behind its
 * `authorized_keys` forced command — plus the hub-side files a real
 * `MachineConnector` connects with: a generated hub key pair, a pinned
 * known_hosts file, and an included SSH configuration whose alias routes the
 * destination through the jump host.
 *
 * Everything here is the real thing the transport uses: the same sshd the
 * operator page describes, the same forced command, and the same generated
 * configuration (`ssh-config.ts`). What the suite asserts on is
 * therefore observed over a real SSH connection, not simulated.
 *
 * Requires a Docker daemon and the OpenSSH client tools on PATH; the suite
 * fails loudly, never silently, when either is missing.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  GenericContainer,
  Network,
  Wait,
  type ExecResult,
  type GenericContainerBuilder,
  type StartedNetwork,
  type StartedTestContainer,
} from 'testcontainers';

import type { MachinesConfig } from '../../instance-config/machines-config';
import { createSshConfigFile, type SshConfigFile } from '../../ssh/ssh-config';
import {
  SSHD_STARTUP_MS,
  ensureRunning,
  startForRestart,
  stopForRestart,
} from './container-restart';
import {
  sshConnection,
  type SshConnectionVariant,
  type SshFixtureFiles,
  type SshdSshConnection,
} from './ssh-connections';

export type {
  SshConnectionVariant,
  SshdSshConnection,
} from './ssh-connections';

const FIXTURES = __dirname;

/** The daemon bundle the box runs; built by `pnpm --filter machine build`. */
const DAEMON_BUNDLE = resolve(
  FIXTURES,
  '../../../..',
  'machine/dist/llame-machine.cjs',
);

/** Where the daemon lives inside the box, as the forced command names it. */
const DAEMON_TARGET = '/usr/local/bin/llame-machine';

/** Where the suite puts the key this container's `box` user may log in with. */
const SETUP_KEYS_TARGET = '/tmp/llame-setup/authorized_keys';

/** Where the suite tells the entrypoint to start the `sh`-only variant. */
const SH_ONLY_TARGET = '/tmp/llame-setup/sh-only';

const BASTION_ALIAS = 'bastion';
const HUB_KEY_COMMENT = 'llame-machine-sshd-test';
const PLAIN_KEY_COMMENT = 'llame-ssh-locator-sshd-test';
const REJECTED_KEY_COMMENT = 'llame-ssh-locator-rejected-key';
const SSHD_HOST_KEY = '/etc/ssh/ssh_host_ed25519_key.pub';

/**
 * The box's login-shell startup file prints through the plain key's
 * `BASH_ENV`, so every `ssh://` session sees text before the read script does.
 * The bytes here are the ones the image writes.
 */
const LOGIN_SHELL_NOISE = 'llame fixture: login shell startup noise';

/** sshd's readiness line: it runs with `-e`, so its log is the container's. */
const SSHD_READY = Wait.forLogMessage(
  /Server listening on 0\.0\.0\.0 port 22/u,
);

/** A silent drop, so the client waits out its own connect timeout. */
const DROP_RULE = ['-p', 'tcp', '--dport', '22', '-j', 'DROP'];

/** The Machine the suite declares, and the alias its SSH route resolves. */
export const MACHINE_SSHD_NAME = 'devl';
export const MACHINE_SSHD_ALIAS = 'box';

/** The box's registered root (baked into the image's roots.json). */
export const MACHINE_SSHD_ROOT = '/home/box/work';
export const MACHINE_SSHD_NOTES_FILE = `${MACHINE_SSHD_ROOT}/notes.txt`;

/** The root-only read fixtures the image creates (ssh-locator task 4.1). */
export const MACHINE_SSHD_FIXTURE_ROOT = `${MACHINE_SSHD_ROOT}/fixture`;

/** The text the login shell writes before every `ssh://` script runs. */
export const MACHINE_SSHD_LOGIN_NOISE = LOGIN_SHELL_NOISE;

/** The `sh`-only container's alias: `/bin/sh` and no `bash`. */
export const MACHINE_SSHD_SH_ALIAS = 'shbox';

/** The bytes the suite expects back for that file, read from the same fixture
 *  the image copies, so the expectation cannot drift from the container. */
export const MACHINE_SSHD_NOTES_CONTENT = readFileSync(
  join(FIXTURES, 'notes.txt'),
  'utf8',
);

/** How an `ssh` child of this process names the daemon it was told to run. */
export const MACHINE_SSHD_REMOTE_COMMAND = 'llame-machine serve --stdio';

/** Which of the four file pairs the suite selects between. */
type ConnectionVariant = {
  /** Keep the jump host's key in the pinned file (the default). */
  readonly pinBastion?: boolean;
  /** Include the configuration that tries to weaken checking and share a
   *  connection, which the safety block must override. */
  readonly weaken?: boolean;
};

/** The four file pairs the suite selects between. */
type Connections = Record<
  'pinned' | 'pinned-weakened' | 'unpinned' | 'unpinned-weakened',
  MachineSshdConnection
>;

/** One reachable configuration: the files a connector is pointed at. */
export type MachineSshdConnection = {
  readonly knownHostsFile: string;
  readonly includeFile: string;
  /** The generated file `ssh -F` is given: safety block, then the include. */
  readonly sshConfig: SshConfigFile;
  readonly machines: MachinesConfig;
};

export type MachineSshd = {
  readonly bastion: StartedTestContainer;
  readonly box: StartedTestContainer;
  /** The same image with `bash` removed and `/bin/sh` as the account's shell. */
  readonly shBox: StartedTestContainer;
  readonly hubKeyFile: string;
  /** The plain-login key both the box and the bastion accept. */
  readonly plainKeyFile: string;
  /** A key neither container accepts. */
  readonly rejectedKeyFile: string;
  /** Where a winning `ControlMaster auto` would have put its socket. */
  readonly controlDirectory: string;
  connection(options?: ConnectionVariant): MachineSshdConnection;
  /** The files an `ssh://` client connects with, over the same route. */
  ssh(options?: SshConnectionVariant): SshdSshConnection;
  /** Run a command inside a container, failing on a non-zero exit. */
  execIn(
    container: StartedTestContainer,
    command: ReadonlyArray<string>,
  ): Promise<ExecResult>;
  /** Make new connections to that container's sshd time out silently. */
  dropPackets(container: StartedTestContainer): Promise<void>;
  /** Restore that container; safe to call when nothing was dropped. */
  restorePackets(container: StartedTestContainer): Promise<void>;
  /**
   * Stop a container the suite means to start again. Testcontainers caches its
   * own `stop` on the handle it handed out — a later `stop` from `dispose`
   * would then be a no-op and leak the container — so this stops through the
   * Docker CLI, which leaves `startForRestart` and teardown working.
   */
  stopForRestart(container: StartedTestContainer): void;
  /**
   * Start that container again and wait until its sshd accepts a connection,
   * which is what the hub needs before it retries (the container's own log is
   * not read here: a restart's readiness is the listener, not a log line).
   */
  startForRestart(container: StartedTestContainer): Promise<void>;
  /** Start a container this suite stopped, for the tests that follow it. */
  ensureRunning(container: StartedTestContainer): Promise<void>;
  dispose(): Promise<void>;
};

type FixtureContext = {
  readonly directory: string;
  readonly controlDirectory: string;
  readonly hubKeyFile: string;
  readonly plainKeyFile: string;
  readonly rejectedKeyFile: string;
  readonly network: StartedNetwork;
  readonly bastionPort: number;
  readonly shBoxPort: number;
  readonly bastion: StartedTestContainer;
  readonly box: StartedTestContainer;
  readonly shBox: StartedTestContainer;
  /** `<name> <key>` lines, one per container, ready for a known_hosts file. */
  readonly hostKeys: {
    readonly bastion: string;
    readonly box: string;
    readonly shBox: string;
  };
  readonly generated: Array<SshConfigFile>;
};

let fixtureBuilder: GenericContainerBuilder | undefined;

/** One builder per suite: every `.build()` re-uses the cached layers. */
function builder(): GenericContainerBuilder {
  fixtureBuilder ??= GenericContainer.fromDockerfile(FIXTURES);
  return fixtureBuilder;
}

/** The daemon bundled for this checkout. */
function daemonBundle(): Buffer {
  try {
    return readFileSync(DAEMON_BUNDLE);
  } catch (error) {
    throw new Error(
      `The Machine SSH integration suite needs the built daemon at ${DAEMON_BUNDLE}: run \`pnpm --filter machine build\`.`,
      { cause: error },
    );
  }
}

/** Fail loudly rather than skipping when the client tools are absent. */
function assertFixtureTools(): void {
  for (const tool of ['ssh', 'ssh-keygen', 'docker']) {
    const probe = spawnSync(tool, ['-V']);
    if (probe.error !== undefined) {
      throw new Error(
        `The Machine SSH integration suite needs the OpenSSH client tools and the Docker CLI (missing ${tool}) on PATH.`,
        { cause: probe.error },
      );
    }
  }
}

/** A throwaway key pair; the suite installs the ones a container may accept. */
function createKey(directory: string, name: string, comment: string): string {
  const keyFile = join(directory, name);
  execFileSync(
    'ssh-keygen',
    ['-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', keyFile],
    { stdio: 'ignore' },
  );
  return keyFile;
}

async function startBastion(
  network: StartedNetwork,
  authorizedKeys: string,
): Promise<StartedTestContainer> {
  return (
    (await builder().build())
      .withNetwork(network)
      .withNetworkAliases(BASTION_ALIAS)
      // NET_ADMIN is how the suite black-holes this hop; nothing else needs it.
      .withAddedCapabilities('NET_ADMIN')
      .withExposedPorts(22)
      // Testcontainers removes a container by default when it is stopped, and
      // the recovery scenario stops the box to restart it; `dispose` removes both.
      .withAutoRemove(false)
      .withCopyContentToContainer([
        { content: authorizedKeys, target: SETUP_KEYS_TARGET, mode: 0o644 },
      ])
      .withWaitStrategy(SSHD_READY)
      .withStartupTimeout(SSHD_STARTUP_MS)
      .start()
  );
}

async function startBox(
  network: StartedNetwork,
  authorizedKeys: string,
  daemon: Buffer,
): Promise<StartedTestContainer> {
  return (await builder().build())
    .withNetwork(network)
    .withNetworkAliases(MACHINE_SSHD_ALIAS)
    .withAutoRemove(false)
    .withCopyContentToContainer([
      { content: authorizedKeys, target: SETUP_KEYS_TARGET, mode: 0o644 },
      // Copied in before start, so the forced command's path exists from the
      // first session, and the image never has to be rebuilt with the daemon.
      { content: daemon, target: DAEMON_TARGET, mode: 0o755 },
    ])
    .withWaitStrategy(SSHD_READY)
    .withStartupTimeout(SSHD_STARTUP_MS)
    .start();
}

/**
 * The `sh`-only variant: the same image with `bash` removed at boot, so an
 * `ssh://` read still succeeds and a `bash` call must be refused.
 */
async function startShBox(
  network: StartedNetwork,
  authorizedKeys: string,
): Promise<StartedTestContainer> {
  return (await builder().build())
    .withNetwork(network)
    .withNetworkAliases(MACHINE_SSHD_SH_ALIAS)
    .withExposedPorts(22)
    .withAutoRemove(false)
    .withCopyContentToContainer([
      { content: authorizedKeys, target: SETUP_KEYS_TARGET, mode: 0o644 },
      { content: '', target: SH_ONLY_TARGET, mode: 0o644 },
    ])
    .withWaitStrategy(SSHD_READY)
    .withStartupTimeout(SSHD_STARTUP_MS)
    .start();
}

/** The container's own host key, as a `<name> <key>` known_hosts line. */
async function hostKeyLine(
  container: StartedTestContainer,
  name: string,
): Promise<string> {
  const result = await container.exec(['cat', SSHD_HOST_KEY]);
  if (result.exitCode !== 0) {
    throw new Error(
      `Reading ${name}'s host key failed: ${result.stderr.trim()}`,
    );
  }
  return `${name} ${result.stdout.trim()}`;
}

/** The operator's own configuration the generated file includes: the alias,
 *  the jump host, the user, and the identity all come from here (design D1). */
function includeConfigText(context: FixtureContext, weaken: boolean): string {
  const weakening = weaken
    ? [
        "  # The suite's attempt to weaken the safety block: ssh keeps the first",
        '  # value it obtains, so neither of these may reach the connection.',
        '  StrictHostKeyChecking accept-new',
        '  ControlMaster auto',
        `  ControlPath ${join(context.controlDirectory, '%C')}`,
      ]
    : [];
  return [
    '# Included by the generated Machine SSH configuration.',
    `Host ${MACHINE_SSHD_ALIAS}`,
    `  HostName ${MACHINE_SSHD_ALIAS}`,
    '  User box',
    '  Port 22',
    `  IdentityFile ${context.hubKeyFile}`,
    `  ProxyJump ${BASTION_ALIAS}`,
    `  HostKeyAlias ${MACHINE_SSHD_ALIAS}`,
    ...weakening,
    '',
    `Host ${BASTION_ALIAS}`,
    '  HostName 127.0.0.1',
    `  Port ${String(context.bastionPort)}`,
    '  User box',
    `  IdentityFile ${context.hubKeyFile}`,
    `  HostKeyAlias ${BASTION_ALIAS}`,
    ...weakening,
    '',
  ].join('\n');
}

function createConnection(
  context: FixtureContext,
  variant: Required<ConnectionVariant>,
): MachineSshdConnection {
  const suffix = variant.weaken ? '-weakened' : '';
  const pinned = variant.pinBastion
    ? [context.hostKeys.bastion, context.hostKeys.box]
    : [context.hostKeys.box];
  const knownHostsFile = join(
    context.directory,
    `known_hosts${variant.pinBastion ? '' : '-unpinned'}${suffix}`,
  );
  writeFileSync(knownHostsFile, `${pinned.join('\n')}\n`, 'utf8');
  const includeFile = join(context.directory, `ssh_config${suffix}`);
  writeFileSync(
    includeFile,
    includeConfigText(context, variant.weaken),
    'utf8',
  );
  const sshConfig = createSshConfigFile({
    knownHostsFile,
    identityFile: context.hubKeyFile,
    includeFile,
  });
  context.generated.push(sshConfig);
  return {
    knownHostsFile,
    includeFile,
    sshConfig,
    machines: {
      ssh: {
        knownHostsFile,
        identityFile: context.hubKeyFile,
        configFile: includeFile,
      },
      hosts: { [MACHINE_SSHD_NAME]: { destination: MACHINE_SSHD_ALIAS } },
    },
  };
}

function connectionsFor(context: FixtureContext): Connections {
  return {
    pinned: createConnection(context, { pinBastion: true, weaken: false }),
    'pinned-weakened': createConnection(context, {
      pinBastion: true,
      weaken: true,
    }),
    unpinned: createConnection(context, { pinBastion: false, weaken: false }),
    'unpinned-weakened': createConnection(context, {
      pinBastion: false,
      weaken: true,
    }),
  };
}

async function execIn(
  container: StartedTestContainer,
  command: ReadonlyArray<string>,
): Promise<ExecResult> {
  const result = await container.exec([...command]);
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(' ')} exited ${String(result.exitCode)} in ${container.getName()}: ${result.stderr.trim()}`,
    );
  }
  return result;
}

async function dropPackets(container: StartedTestContainer): Promise<void> {
  await execIn(container, ['iptables', '-A', 'INPUT', ...DROP_RULE]);
}

/** Idempotent, so teardown can call it without knowing what a test did. */
async function restorePackets(container: StartedTestContainer): Promise<void> {
  const present = await container.exec([
    'iptables',
    '-C',
    'INPUT',
    ...DROP_RULE,
  ]);
  if (present.exitCode !== 0) return;
  await execIn(container, ['iptables', '-D', 'INPUT', ...DROP_RULE]);
}

/**
 * Teardown never fails an otherwise-green run; say what leaked instead, and
 * remember the reaper still collects anything labeled with this run.
 */
async function teardown(
  what: string,
  step: () => Promise<void>,
): Promise<void> {
  try {
    await step();
  } catch (error) {
    console.warn(
      `[machine-sshd] ${what}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** The known_hosts lines and host names every `ssh://` connection file set uses. */
function sshFixtureFiles(context: FixtureContext): SshFixtureFiles {
  return {
    directory: context.directory,
    controlDirectory: context.controlDirectory,
    plainKeyFile: context.plainKeyFile,
    bastionPort: context.bastionPort,
    shBoxPort: context.shBoxPort,
    hostKeys: context.hostKeys,
    hosts: {
      box: MACHINE_SSHD_ALIAS,
      bastion: BASTION_ALIAS,
      shBox: MACHINE_SSHD_SH_ALIAS,
    },
  };
}

/** Remove every container, the network, and the private directory. */
async function disposeFixture(context: FixtureContext): Promise<void> {
  const remove = { remove: true, removeVolumes: true };
  for (const generated of context.generated) generated.dispose();
  await teardown('stopping the sh-only box failed', async () => {
    await context.shBox.stop(remove);
  });
  await teardown('stopping the box failed', async () => {
    await context.box.stop(remove);
  });
  await teardown('stopping the bastion failed', async () => {
    await context.bastion.stop(remove);
  });
  await teardown('removing the fixture network failed', async () => {
    await context.network.stop();
  });
  rmSync(context.directory, { recursive: true, force: true });
}

function fixture(
  context: FixtureContext,
  connections: Connections,
): MachineSshd {
  const sshConnections = new Map<string, SshdSshConnection>();
  const files = sshFixtureFiles(context);
  return {
    bastion: context.bastion,
    box: context.box,
    shBox: context.shBox,
    hubKeyFile: context.hubKeyFile,
    plainKeyFile: context.plainKeyFile,
    rejectedKeyFile: context.rejectedKeyFile,
    controlDirectory: context.controlDirectory,
    connection: (options = {}) => {
      const pinned = (options.pinBastion ?? true) ? 'pinned' : 'unpinned';
      return options.weaken === true
        ? connections[`${pinned}-weakened`]
        : connections[pinned];
    },
    ssh: (options = {}) => sshConnection(sshConnections, files, options),
    execIn,
    dropPackets,
    restorePackets,
    stopForRestart,
    startForRestart,
    ensureRunning,
    dispose: () => disposeFixture(context),
  };
}

/** The key pairs every container is started with, and their public halves. */
type FixtureKeys = {
  readonly hubKeyFile: string;
  readonly plainKeyFile: string;
  readonly rejectedKeyFile: string;
  readonly hubPublic: string;
  readonly plainPublic: string;
};

function createFixtureKeys(directory: string): FixtureKeys {
  const hubKeyFile = createKey(directory, 'hub_ed25519', HUB_KEY_COMMENT);
  const plainKeyFile = createKey(directory, 'plain_ed25519', PLAIN_KEY_COMMENT);
  const rejectedKeyFile = createKey(
    directory,
    'rejected_ed25519',
    REJECTED_KEY_COMMENT,
  );
  return {
    hubKeyFile,
    plainKeyFile,
    rejectedKeyFile,
    hubPublic: readFileSync(`${hubKeyFile}.pub`, 'utf8').trim(),
    plainPublic: readFileSync(`${plainKeyFile}.pub`, 'utf8').trim(),
  };
}

/**
 * The three containers, each with only the `authorized_keys` lines it needs:
 * the hub key may only forward from the bastion and only run the daemon on the
 * box, and the plain key is a login the `ssh://` suite uses, with the box's
 * login-shell startup noise enabled on that host alone.
 */
async function startContainers(
  network: StartedNetwork,
  keys: FixtureKeys,
  daemon: Buffer,
): Promise<{
  readonly bastion: StartedTestContainer;
  readonly box: StartedTestContainer;
  readonly shBox: StartedTestContainer;
}> {
  const forwarding = `restrict,port-forwarding,permitopen="${MACHINE_SSHD_ALIAS}:22"`;
  const bastion = await startBastion(
    network,
    `${forwarding} ${keys.hubPublic}\n${forwarding} ${keys.plainPublic}\n`,
  );
  const box = await startBox(
    network,
    `restrict,command="${DAEMON_TARGET} serve --stdio" ${keys.hubPublic}\n` +
      `restrict,environment="BASH_ENV=/home/box/.bashrc" ${keys.plainPublic}\n`,
    daemon,
  );
  const shBox = await startShBox(network, `restrict ${keys.plainPublic}\n`);
  return { bastion, box, shBox };
}

async function provision(directory: string): Promise<MachineSshd> {
  const keys = createFixtureKeys(directory);
  const network = await new Network().start();
  const { bastion, box, shBox } = await startContainers(
    network,
    keys,
    daemonBundle(),
  );
  const context: FixtureContext = {
    directory,
    controlDirectory: join(directory, 'control'),
    hubKeyFile: keys.hubKeyFile,
    plainKeyFile: keys.plainKeyFile,
    rejectedKeyFile: keys.rejectedKeyFile,
    network,
    bastionPort: bastion.getMappedPort(22),
    shBoxPort: shBox.getMappedPort(22),
    bastion,
    box,
    shBox,
    hostKeys: {
      bastion: await hostKeyLine(bastion, BASTION_ALIAS),
      box: await hostKeyLine(box, MACHINE_SSHD_ALIAS),
      shBox: await hostKeyLine(shBox, MACHINE_SSHD_SH_ALIAS),
    },
    generated: [],
  };
  return fixture(context, connectionsFor(context));
}

/**
 * Build the image, start both containers, and pin their host keys. Everything
 * the suite needs lives under one private directory, removed by `dispose`.
 */
export async function startMachineSshd(): Promise<MachineSshd> {
  assertFixtureTools();
  const directory = mkdtempSync(join(tmpdir(), 'llame-machine-sshd-'));
  try {
    mkdirSync(join(directory, 'control'), { mode: 0o700 });
    return await provision(directory);
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
