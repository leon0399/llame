import { execFileSync } from 'node:child_process';
import { watch, existsSync, chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { connect as connectNetSocket, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { connectSocket } from '@workspace/machine-protocol';
import type { Transport } from '@connectrpc/connect';
import type { ResolvedSshFiles } from '../instance-config/machines-config';
import {
  createSshConfigFile,
  defaultSshConfigFile,
  type SshConfigFile,
} from '../ssh/ssh-config';
import {
  spawnSshProcess,
  type SshSpawn,
  classifySshLinkFailure,
} from '../ssh/ssh-process';
import {
  MachineIdentityMismatchError,
  MachineUnavailableError,
} from './machine-session-errors';
import {
  createProcessTransport,
  machineSocketPath,
  type MachineLinkEnd,
  type MachineTransport,
  type MachineTransportFactory,
  type MachineTransportRequest,
} from './machine-transport';

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

export type MachineSshTransportFactory = MachineTransportFactory & {
  /** The generated configuration's text, or undefined when none was written. */
  readonly sshConfigText: () => string | undefined;
  /** Remove the generated configuration's private directory. */
  dispose(): void;
};

type SshSessionDependencies = {
  readonly ssh: ResolvedSshFiles | undefined;
  readonly spawnLink: SshSpawn;
  readonly path: (ssh: ResolvedSshFiles) => string;
  readonly runCommand: SshMachineCommandRunner;
  readonly connect?: SshMachineSocketConnector;
};

/** Opens the socket-tunnelled SSH session for one Machine. */
function openSshSession(
  deps: SshSessionDependencies,
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

  const remoteSocket = discoverSshSocket(
    deps.runCommand,
    configPath,
    destination,
    request.name,
  );

  return createSshSocketTunnel(deps, {
    configPath,
    destination,
    remoteSocket,
    name: request.name,
  });
}

function discoverSshSocket(
  runCommand: SshMachineCommandRunner,
  configPath: string,
  destination: string,
  name: string,
): string {
  let output: string;

  try {
    output = runCommand('ssh', [
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
    const diagnostic = sshErrorDiagnostic(error);

    if (error instanceof Error && 'status' in error && error.status === 78)
      throw new MachineIdentityMismatchError(name);

    throw new MachineUnavailableError(
      name,
      classifySshLinkFailure(false, diagnostic),
      false,
      diagnostic,
    );
  }

  const remoteSocket = machineSocketPath(output);

  if (remoteSocket === undefined)
    throw new MachineUnavailableError(
      name,
      'unreachable',
      false,
      'The Machine daemon did not return a valid socket path.',
    );

  return remoteSocket;
}

function sshErrorDiagnostic(error: unknown): string {
  if (error instanceof Error && 'stderr' in error) {
    const stderr = error.stderr;

    if (Buffer.isBuffer(stderr)) return stderr.toString('utf8');

  }

  return error instanceof Error ? error.message : String(error);
}

type SshTunnelDependencies = {
  readonly spawnLink: SshSpawn;
  readonly connect?: SshMachineSocketConnector;
};

type SshTunnelOptions = {
  readonly configPath: string;
  readonly destination: string;
  readonly remoteSocket: string;
  readonly name: string;
};

function createSshSocketTunnel(
  deps: SshTunnelDependencies,
  options: SshTunnelOptions,
): MachineTransport {
  const socketDirectory = mkdtempSync(join(tmpdir(), 'llame-machine-ssh-'));
  chmodSync(socketDirectory, 0o700);
  const localSocket = join(socketDirectory, 'machine.sock');

  const link = spawnSshTunnel(deps.spawnLink, {
    configPath: options.configPath,
    destination: options.destination,
    localSocket,
    remoteSocket: options.remoteSocket,
  });

  if (deps.connect !== undefined) {
    const socket = deps.connect(localSocket);

    return bindSshTunnel(
      connectSocket(socket),
      () => socket.destroy(),
      link,
      socketDirectory,
    );
  }

  const lazy = createLazySshSocketTransport(localSocket, options.name, link);

  return bindSshTunnel(
    lazy.transport,
    () => lazy.close(),
    link,
    socketDirectory,
  );
}

function bindSshTunnel(
  rpcTransport: Transport,
  closeSocket: () => void,
  link: MachineTransport,
  socketDirectory: string,
): MachineTransport {
  let closedByHub = false;
  const { promise: ended, resolve } = Promise.withResolvers<MachineLinkEnd>();

  void link.ended.then((end) => {
    rmSync(socketDirectory, { recursive: true, force: true });
    resolve({ ...end, closedByHub });
  });

  return {
    rpcTransport,
    close: () => {
      closedByHub = true;
      closeSocket();
      link.close();
      rmSync(socketDirectory, { recursive: true, force: true });
    },
    ended,
  };
}

type LazySshSocketTransport = {
  readonly transport: Transport;
  close(): void;
};

function createLazySshSocketTransport(
  localSocket: string,
  name: string,
  link: MachineTransport,
): LazySshSocketTransport {
  let socket: Socket | undefined;
  let transport: Promise<Transport> | undefined;
  let closed = false;

  function open(): Promise<Transport> {
    transport ??= waitForSshSocket(localSocket, name, link.ended).then(() => {
      if (closed) throw new MachineUnavailableError(name, 'unreachable', false, 'The SSH socket tunnel was closed before connecting.');

      socket = connectNetSocket(localSocket);
      socket.once('close', () => {
        if (!closed) link.close();
      });
      socket.once('error', () => undefined);

      return connectSocket(socket);
    });

    return transport;
  }

  return {
    transport: createDeferredTransport(open),
    close: () => {
      closed = true;
      socket?.destroy();
    },
  };
}

function createDeferredTransport(
  open: () => Promise<Transport>,
): Transport {
  return {
    unary: (...args) => open().then((ready) => ready.unary(...args)),
    stream: (...args) => open().then((ready) => ready.stream(...args)),
  };
}

function waitForSshSocket(
  localSocket: string,
  name: string,
  ended: Promise<MachineLinkEnd>,
): Promise<void> {
  if (existsSync(localSocket)) return Promise.resolve();

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  let settled = false;

  const watcher = watch(dirname(localSocket), () => {
    if (existsSync(localSocket)) finish();
  });

  const timeout = sshSocketTimeout(name, finish);

  function finish(error?: Error): void {
    if (settled) return;

    settled = true;
    clearTimeout(timeout);
    watcher.close();

    if (error === undefined) resolve();
    else reject(error);
  }

  void ended.then((end) => {
    finish(
      new MachineUnavailableError(
        name,
        classifySshLinkFailure(false, end.diagnostic),
        false,
        end.diagnostic || 'The SSH tunnel ended before its local socket opened.',
      ),
    );
  });

  if (existsSync(localSocket)) finish();

  return promise;
}

function sshSocketTimeout(
  name: string,
  finish: (error?: Error) => void,
): NodeJS.Timeout {
  return setTimeout(
    () =>
      finish(
        new MachineUnavailableError(
          name,
          'unreachable',
          false,
          'The SSH socket tunnel did not create its local socket.',
        ),
      ),
    10_000,
  );
}

function spawnSshTunnel(
  spawnLink: SshSpawn,
  options: {
    readonly configPath: string;
    readonly destination: string;
    readonly localSocket: string;
    readonly remoteSocket: string;
  },
): MachineTransport {
  return createProcessTransport(
    spawnLink('ssh', [
      '-F',
      options.configPath,
      '-N',
      '-o',
      'StreamLocalBindUnlink=yes',
      '-L',
      `${options.localSocket}:${options.remoteSocket}`,
      '--',
      options.destination,
    ]),
  );
}

/** OpenSSH parses host:port only when passed in URI form. */
function sshDestination(destination: string): string {
  return destination.includes(':') ? `ssh://${destination}` : destination;
}

/** Starts an SSH transport with one generated config per process. */
export function createMachineSshTransportFactory(
  options: MachineSshTransportFactoryOptions,
): MachineSshTransportFactory {
  const spawnLink = options.spawn ?? spawnSshProcess;

  const runCommand =
    options.runCommand ??
    ((command, args) => execFileSync(command, [...args], { encoding: 'utf8' }));

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
          connect: options.connect,
        },
        request,
      ),
    dispose: () => {
      configFile?.dispose();
      configFile = undefined;
    },
  };
}
