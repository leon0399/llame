/**
 * The byte-level link to one Machine (remote-machines design D1/D3). A
 * transport is what the session frames ride on: SSH's stdio pipes in
 * production, an in-process peer in tests. It reports the raw facts of how the
 * link ended (exit status, bounded stderr) so the session can classify them
 * into the one closed set of failure reasons the status column accepts.
 *
 * Production link: `ssh -F <generated> -T -- <destination> llame-machine
 * attach --print-socket`. `-F` carries the generated safety block
 * (ssh-config.ts) and the `Include` of the operator's own configuration.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { connect as connectNetSocket, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectSocket } from '@workspace/machine-protocol';
import type { Readable, Writable } from 'node:stream';
import type { Transport } from '@connectrpc/connect';
import type { JsonValue } from '@workspace/machine-protocol';
import type { ResolvedSshFiles } from '../instance-config/machines-config';
import {
  createSshConfigFile,
  defaultSshConfigFile,
  type SshConfigFile,
} from '../ssh/ssh-config';
import {
  collectSshDiagnostic,
  spawnSshProcess,
  type SshProcess,
  type SshSpawn,
} from '../ssh/ssh-process';
import type {
  MachineRequestHandler,
  MachineRequestOptions,
  MachineStreamHandler,
} from './machine-session';
import {
  MachineIdentityMismatchError,
  MachineUnavailableError,
} from './machine-session-errors';

/** How the link ended; `diagnostic` is the link process's own stderr. */
export type MachineLinkEnd = {
  readonly code: number | null;
  readonly signal: string | null;
  readonly diagnostic: string;
  /** True when llame ended the link itself (idle close or shutdown). */
  readonly closedByHub: boolean;
};

/** Extracts the daemon's absolute socket path from command output. */
export function machineSocketPath(output: string): string | undefined {
  const matches = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('/') && line.endsWith('/daemon.sock'));

  return matches.length === 1 ? matches[0] : undefined;
}

export type MachineTransport =
  | {
      readonly input: Readable;
      readonly output: Writable;
      close(): void;
      readonly ended: Promise<MachineLinkEnd>;
    }
  | {
      readonly rpcTransport: Transport;
      close(): void;
      readonly ended: Promise<MachineLinkEnd>;
    };

export type MachineTransportFactory = {
  readonly requestHandler?: MachineRequestHandler;
  readonly streamHandler?: MachineStreamHandler;
  open(request: MachineTransportRequest): MachineTransport;
};
export type MachineTransportRequest = {
  readonly name: string;
  readonly destination?: string;
};

/** Wrap a spawned link process as a transport. */
export function createProcessTransport(link: SshProcess): MachineTransport {
  const diagnostic = collectSshDiagnostic(link.stderr);
  let closedByHub = false;

  const ended = new Promise<MachineLinkEnd>((resolve) => {
    link.onClose((code, signal) =>
      resolve({ code, signal, diagnostic: diagnostic(), closedByHub }),
    );
    link.onError((error) => {
      // A link that never started (no ssh, no permission) ends here.
      resolve({
        code: null,
        signal: null,
        diagnostic: error.message,
        closedByHub,
      });
    });
  });

  return {
    input: link.stdout,
    output: link.stdin,
    close: () => {
      if (closedByHub) return;
      closedByHub = true;
      link.kill();
    },
    ended,
  };
}

export type SshMachineCommandRunner = (
  command: string,
  args: ReadonlyArray<string>,
) => string;

export type SshMachineSocketConnector = (path: string) => Socket;

export type MachineSshTransportFactoryOptions = {
  readonly ssh: ResolvedSshFiles | undefined;
  /** Test seam: where the SSH tunnel process comes from. */
  readonly spawn?: SshSpawn;
  /** Test seam: a pre-made generated configuration file. */
  readonly configFile?: SshConfigFile;
  /** Test seam for obtaining the remote daemon socket path. */
  readonly runCommand?: SshMachineCommandRunner;
  /** Test seam for opening the forwarded Unix socket. */
  readonly connect?: SshMachineSocketConnector;
};

/**
 * Opens a socket-tunnelled SSH session, after the destination and settings
 * guards: the connector picks this factory only for an entry with a
 * destination, and the guards keep a direct caller from spawning SSH for an
 * undefined destination.
 */
function openSshSession(
  deps: {
    readonly ssh: ResolvedSshFiles | undefined;
    readonly spawnLink: SshSpawn;
    readonly path: (ssh: ResolvedSshFiles) => string;
    readonly runCommand: SshMachineCommandRunner;
    readonly connect: SshMachineSocketConnector;
  },
  request: MachineTransportRequest,
): MachineTransport {
  if (request.destination === undefined)
    throw new MachineUnavailableError(
      request.name,
      'unreachable',
      false,
      'This Machine has no SSH destination.',
    );
  const ssh = deps.ssh;

  if (ssh === undefined)
    throw new MachineUnavailableError(
      request.name,
      'unreachable',
      false,
      'No Machine SSH settings are configured.',
    );

  const configPath = deps.path(ssh);
  const destination = sshDestination(request.destination);
  let remoteSocketOutput: string;

  try {
    remoteSocketOutput = deps.runCommand('ssh', [
      '-F',
      configPath,
      '-T',
      '--',
      destination,
      'llame-machine',
      'attach',
      '--print-socket',
    ]);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      error.status === 78
    )
      throw new MachineIdentityMismatchError(request.name);

    throw new MachineUnavailableError(
      request.name,
      'unreachable',
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  const remoteSocket = machineSocketPath(remoteSocketOutput);

  if (remoteSocket === undefined)
    throw new MachineUnavailableError(
      request.name,
      'unreachable',
      false,
      'The Machine daemon did not return a valid socket path.',
    );

  const socketDirectory = mkdtempSync(join(tmpdir(), 'llame-machine-ssh-'));
  chmodSync(socketDirectory, 0o700);
  const localSocket = join(socketDirectory, 'machine.sock');

  const link = createProcessTransport(
    deps.spawnLink('ssh', [
      '-F',
      configPath,
      '-N',
      '-o',
      'StreamLocalBindUnlink=yes',
      '-L',
      `${localSocket}:${remoteSocket}`,
      '--',
      destination,
    ]),
  );

  const socket = deps.connect(localSocket);
  let closedByHub = false;
  const { promise: ended, resolve } = Promise.withResolvers<MachineLinkEnd>();
  void link.ended.then((end) => {
    rmSync(socketDirectory, { recursive: true, force: true });
    resolve({ ...end, closedByHub });
  });
  socket.once('close', () => {
    if (closedByHub) return;
    link.close();
  });
  socket.once('error', () => undefined);

  return {
    rpcTransport: connectSocket(socket),
    close: () => {
      closedByHub = true;
      socket.destroy();
      link.close();
      rmSync(socketDirectory, { recursive: true, force: true });
    },
    ended,
  };
}

export type MachineSshTransportFactory = MachineTransportFactory & {
  /** The generated configuration's text, or undefined when none was written. */
  readonly sshConfigText: () => string | undefined;
  /** Remove the generated configuration's private directory. */
  dispose(): void;
};

/**
 * The destination as ssh's argv takes it. OpenSSH reads a bare
 * `[user@]host:port` as a host name containing a colon, so a configured port
 * is passed in the URI form `ssh://[user@]host:port` that ssh does parse; an
 * alias or a portless host is passed as written.
 */
function sshDestination(destination: string): string {
  return destination.includes(':') ? `ssh://${destination}` : destination;
}

/**
 * The production factory: one generated SSH configuration per process, written
 * on first use, and one `ssh` process per session.
 */
export function createMachineSshTransportFactory(
  options: MachineSshTransportFactoryOptions,
): MachineSshTransportFactory {
  const spawnLink = options.spawn ?? spawnSshProcess;

  const runCommand =
    options.runCommand ??
    ((command, args) => execFileSync(command, [...args], { encoding: 'utf8' }));

  const connect = options.connect ?? connectNetSocket;
  let configFile = options.configFile;

  function path(ssh: ResolvedSshFiles): string {
    configFile ??= createSshConfigFile({
      knownHostsFile: ssh.knownHostsFile,
      identityFile: ssh.identityFile,
      includeFile: ssh.configFile ?? defaultSshConfigFile(),
    });

    return configFile.path;
  }

  return {
    sshConfigText: () => configFile?.text,
    open: (request) =>
      openSshSession(
        {
          ssh: options.ssh,
          spawnLink,
          path,
          runCommand,
          connect,
        },
        request,
      ),
    dispose: () => {
      configFile?.dispose();
      configFile = undefined;
    },
  };
}
