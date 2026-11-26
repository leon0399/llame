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
import { watch, existsSync, chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { connect as connectNetSocket, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { connectSocket } from '@workspace/machine-protocol';
import type { Readable, Writable } from 'node:stream';
import type {
  ContextValues,
  StreamResponse,
  Transport,
  UnaryResponse,
} from '@connectrpc/connect';
import type {
  DescMessage,
  DescMethodStreaming,
  DescMethodUnary,
  MessageInitShape,
} from '@bufbuild/protobuf';
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
  classifySshLinkFailure,
} from '../ssh/ssh-process';
import type {
  MachineRequestHandler,
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
    readonly connect?: SshMachineSocketConnector;
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

  const remoteSocket = discoverSshSocket(
    deps.runCommand,
    configPath,
    destination,
    request.name,
  );

  return createSshSocketTunnel(
    deps,
    configPath,
    destination,
    remoteSocket,
    request.name,
  );
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
    if (typeof stderr === 'string') return stderr;
  }

  return error instanceof Error ? error.message : String(error);
}

function createSshSocketTunnel(
  deps: {
    readonly spawnLink: SshSpawn;
    readonly connect?: SshMachineSocketConnector;
  },
  configPath: string,
  destination: string,
  remoteSocket: string,
  name: string,
): MachineTransport {
  const socketDirectory = mkdtempSync(join(tmpdir(), 'llame-machine-ssh-'));
  chmodSync(socketDirectory, 0o700);
  const localSocket = join(socketDirectory, 'machine.sock');

  const link = spawnSshTunnel(deps.spawnLink, {
    configPath,
    destination,
    localSocket,
    remoteSocket,
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

  const lazy = createLazySshSocketTransport(localSocket, name, link);

  return bindSshTunnel(
    lazy.transport,
    lazy.close,
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

function createLazySshSocketTransport(
  localSocket: string,
  name: string,
  link: MachineTransport,
): { readonly transport: Transport; close(): void } {
  let socket: Socket | undefined;
  let transport: Promise<Transport> | undefined;
  let closed = false;

  function open(): Promise<Transport> {
    transport ??= waitForSshSocket(localSocket, name, link.ended).then(() => {
      if (closed)
        throw new MachineUnavailableError(
          name,
          'unreachable',
          false,
          'The SSH socket tunnel was closed before connecting.',
        );

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
    transport: {
      unary<I extends DescMessage, O extends DescMessage>(
        method: DescMethodUnary<I, O>,
        signal: AbortSignal | undefined,
        timeoutMs: number | undefined,
        header: HeadersInit | undefined,
        input: MessageInitShape<I>,
        contextValues?: ContextValues,
      ): Promise<UnaryResponse<I, O>> {
        return open().then((ready) =>
          ready.unary(method, signal, timeoutMs, header, input, contextValues),
        );
      },
      stream<I extends DescMessage, O extends DescMessage>(
        method: DescMethodStreaming<I, O>,
        signal: AbortSignal | undefined,
        timeoutMs: number | undefined,
        header: HeadersInit | undefined,
        input: AsyncIterable<MessageInitShape<I>>,
        contextValues?: ContextValues,
      ): Promise<StreamResponse<I, O>> {
        return open().then((ready) =>
          ready.stream(method, signal, timeoutMs, header, input, contextValues),
        );
      },
    },
    close: () => {
      closed = true;
      socket?.destroy();
    },
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
  const timeout = setTimeout(() => {
    finish(
      new MachineUnavailableError(
        name,
        'unreachable',
        false,
        'The SSH socket tunnel did not create its local socket.',
      ),
    );
  }, 10_000);

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
