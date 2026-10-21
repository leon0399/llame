/**
 * The one-shot `ssh://` transport (ssh-locator design D1, D2, D3): the
 * destination resolution every admitted call binds to, and the one-shot runner
 * remote reads and `bash` use.
 *
 * Both go through one generated safety configuration (ssh-config.ts), created
 * lazily on first use and shared for the process lifetime, and both use the
 * shared spawn seam (ssh-process.ts) so a test drives argv, bounds, deadlines,
 * and aborts without an `ssh` binary.
 *
 * Resolution is `ssh -F <generated> -G [-l user] [-p port] -- <host>`: a local
 * evaluation that never connects, bounded to 5 s and 64 KiB. Execution binds
 * the resolved address with `-o HostName= -o Port= -o User=` while the
 * submitted host stays ssh's destination, so a `Host`-scoped `ProxyJump` or
 * identity from the included configuration still matches the submitted name
 * and the address the hub checked is the address it connects to.
 */

import type { SshConfig } from '../instance-config/ssh-settings';
import {
  createSshConfigFile,
  defaultSshConfigFile,
  type SshConfigFile,
} from './ssh-config';
import {
  collectSshDiagnostic,
  spawnSshProcess,
  type SshLinkFailureReason,
  type SshProcess,
  type SshSpawn,
} from './ssh-process';

/** How long a destination may resolve before the call fails as `config`. */
export const SSH_RESOLUTION_DEADLINE_MS = 5000;

/** The bound of `ssh -G` output the resolver accepts. */
export const SSH_RESOLUTION_OUTPUT_BYTES = 64 * 1024;

/** The resolved address a connection binds to. */
export type SshResolvedDestination = {
  readonly user: string;
  /** Unbracketed and lowercase; an IPv6 literal keeps its colons. */
  readonly host: string;
  readonly port: number;
};

export type SshResolveRequest = {
  /** Bare host, unbracketed, exactly as the locator named it. */
  readonly host: string;
  /** A user written in the locator; otherwise the included configuration decides. */
  readonly user?: string;
  /** A port written in the locator; otherwise the included configuration decides. */
  readonly port?: number;
  readonly signal?: AbortSignal;
};

/** The reasons an `ssh://` operation reports as `ssh_unavailable`. */
export type SshOperationFailureReason =
  | SshLinkFailureReason
  | 'config'
  | 'client_missing';

export type SshResolution =
  | {
      readonly outcome: 'resolved';
      readonly destination: SshResolvedDestination;
    }
  | { readonly outcome: 'cancelled' }
  | {
      readonly outcome: 'failed';
      readonly reason: 'config' | 'client_missing';
      readonly diagnostic: string;
    };

export type SshRunRequest = {
  /** The submitted host, passed after `--` as ssh's destination. */
  readonly destination: string;
  /** The resolved address; binds every connect option and wins over user/port. */
  readonly resolved?: SshResolvedDestination;
  /** A user written in the locator, when the call was not resolved. */
  readonly user?: string;
  /** A port written in the locator, when the call was not resolved. */
  readonly port?: number;
  /** The remote command argv; model text never reaches it for reads. */
  readonly remoteCommand: ReadonlyArray<string>;
  /** Script bytes written to stdin, then stdin is closed. */
  readonly input?: string | Buffer;
  /** The caller's stdout bound; bytes after it are dropped and flagged. */
  readonly maxStdoutBytes: number;
  readonly deadlineMs: number;
  readonly signal?: AbortSignal;
};

export type SshRunOutcome =
  | {
      readonly outcome: 'ended';
      /** Byte-exact stdout, at most `maxStdoutBytes` long. */
      readonly stdout: Buffer;
      /** True when ssh wrote more stdout than the caller's bound. */
      readonly stdoutOverflow: boolean;
      /** The bounded stderr head, kept for classification and the operator. */
      readonly diagnostic: string;
      readonly code: number | null;
      readonly signal: string | null;
    }
  | {
      readonly outcome: 'failed';
      readonly reason: 'client_missing' | 'timed_out' | 'cancelled';
      readonly diagnostic: string;
    };

/** The `ssh://` transport one worker process shares. */
export type SshClient = {
  resolve(request: SshResolveRequest): Promise<SshResolution>;
  run(request: SshRunRequest): Promise<SshRunOutcome>;
  /** The generated configuration's text, or undefined when none was written. */
  sshConfigText(): string | undefined;
  /** Remove the generated configuration's private directory. */
  dispose(): void;
};

/** The resolved destination one admitted `ssh://` call hands to execution. */
export type SshBinding = {
  /** The submitted host, which stays ssh's destination for Host-scoped settings. */
  readonly destination: string;
  /** The resolved login user the connection binds with `-o User=`. */
  readonly user: string;
  /** The resolved hostname the connection binds with `-o HostName=`. */
  readonly hostname: string;
  /** The resolved port the connection binds with `-o Port=`. */
  readonly port: number;
  /** The canonical locator permission was decided on. */
  readonly locator: string;
};

export type SshClientOptions = {
  readonly ssh: SshConfig;
  /** Test seam: where the `ssh` process comes from. */
  readonly spawn?: SshSpawn;
  /** Test seam: a pre-made generated configuration file. */
  readonly configFile?: SshConfigFile;
  readonly resolutionDeadlineMs?: number;
  readonly resolutionOutputBytes?: number;
};

/** Does a spawn error mean the `ssh` client itself is missing? */
function isMissingClient(error: Error): boolean {
  // SAFETY: Node attaches `code` to the error a failed `spawn` emits; an
  // error without one is not ENOENT.
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Read the resolved `user`, `hostname`, and `port` from `ssh -G` output. */
function parseResolvedDestination(
  output: string,
): SshResolvedDestination | undefined {
  const values: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const separator = line.indexOf(' ');
    if (separator <= 0) continue;
    values[line.slice(0, separator).toLowerCase()] = line
      .slice(separator + 1)
      .trim();
  }
  const { user, hostname, port: portText } = values;
  if (user === undefined || hostname === undefined) return undefined;
  if (portText === undefined || !/^[0-9]{1,5}$/u.test(portText))
    return undefined;
  const port = Number(portText);
  if (port < 1 || port > 65_535) return undefined;
  return { user, host: hostname.toLowerCase(), port };
}

/** One bounded ssh process's raw end: bytes, diagnostic, and exit facts. */
type BoundedSshEnd =
  | {
      readonly kind: 'ended';
      readonly stdout: Buffer;
      readonly stdoutOverflow: boolean;
      readonly diagnostic: string;
      readonly code: number | null;
      readonly signal: string | null;
    }
  | {
      readonly kind: 'failed';
      readonly reason: 'client_missing' | 'timed_out' | 'cancelled';
      readonly diagnostic: string;
    };

type BoundedSshLimits = {
  readonly maxStdoutBytes: number;
  readonly deadlineMs: number;
  readonly signal?: AbortSignal;
  readonly input?: string | Buffer;
};

type BoundedWiring = {
  readonly process: SshProcess;
  readonly state: { stdout: Buffer; overflow: boolean };
  readonly diagnostic: () => string;
  readonly finish: (end: BoundedSshEnd) => void;
  readonly maxStdoutBytes: number;
};

/** Append one chunk under the caller's byte bound, flagging dropped bytes. */
function appendBounded(
  current: Buffer,
  chunk: Buffer | string,
  maxBytes: number,
) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const room = maxBytes - current.length;
  if (bytes.length <= room)
    return { stdout: Buffer.concat([current, bytes]), overflow: false };
  return {
    stdout:
      room > 0 ? Buffer.concat([current, bytes.subarray(0, room)]) : current,
    overflow: true,
  };
}

/** Wire one process's streams and exit into the bounded outcome. */
function wireBoundedProcess(wiring: BoundedWiring): void {
  const { process, state, diagnostic, finish, maxStdoutBytes } = wiring;
  process.stdout.on('data', (chunk: Buffer | string) => {
    const appended = appendBounded(state.stdout, chunk, maxStdoutBytes);
    state.stdout = appended.stdout;
    state.overflow ||= appended.overflow;
  });
  process.stdout.on('error', () => undefined);
  process.onError((error) =>
    finish({
      kind: 'failed',
      reason: isMissingClient(error) ? 'client_missing' : 'timed_out',
      diagnostic: error.message,
    }),
  );
  process.onClose((code, signal) =>
    finish({
      kind: 'ended',
      stdout: state.stdout,
      stdoutOverflow: state.overflow,
      diagnostic: diagnostic(),
      code,
      signal,
    }),
  );
}

/** Run one bounded `ssh` process and report its raw facts. */
function runBoundedSsh(
  spawn: SshSpawn,
  args: ReadonlyArray<string>,
  limits: BoundedSshLimits,
): Promise<BoundedSshEnd> {
  const { promise, resolve } = Promise.withResolvers<BoundedSshEnd>();
  const process = spawn('ssh', args);
  const diagnostic = collectSshDiagnostic(process.stderr);
  const state = { stdout: Buffer.alloc(0), overflow: false };
  let settled = false;
  const finish = (end: BoundedSshEnd) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    limits.signal?.removeEventListener('abort', onAbort);
    process.kill();
    resolve(end);
  };
  const fail = (reason: 'client_missing' | 'timed_out' | 'cancelled') =>
    finish({ kind: 'failed', reason, diagnostic: diagnostic() });
  const onAbort = () => fail('cancelled');
  const timer = setTimeout(() => fail('timed_out'), limits.deadlineMs);

  wireBoundedProcess({
    process,
    state,
    diagnostic,
    finish,
    maxStdoutBytes: limits.maxStdoutBytes,
  });
  if (limits.signal?.aborted === true) onAbort();
  else limits.signal?.addEventListener('abort', onAbort, { once: true });
  process.stdin.end(limits.input ?? '');
  return promise;
}

/** The resolution argv: a local config evaluation that never connects. */
function resolveArgs(
  configPath: string,
  request: SshResolveRequest,
): ReadonlyArray<string> {
  return [
    '-F',
    configPath,
    '-G',
    ...(request.user === undefined ? [] : ['-l', request.user]),
    ...(request.port === undefined ? [] : ['-p', String(request.port)]),
    '--',
    request.host,
  ];
}

/** The execution argv: a resolved address binds with `-o`, not the destination. */
function runArgs(
  configPath: string,
  request: SshRunRequest,
): ReadonlyArray<string> {
  const args = ['-F', configPath, '-T'];
  if (request.resolved === undefined) {
    if (request.user !== undefined) args.push('-l', request.user);
    if (request.port !== undefined) args.push('-p', String(request.port));
  } else {
    args.push(
      '-o',
      `HostName=${request.resolved.host}`,
      '-o',
      `Port=${String(request.resolved.port)}`,
      '-o',
      `User=${request.resolved.user}`,
    );
  }
  args.push('--', request.destination, ...request.remoteCommand);
  return args;
}

function resolvedFromEnd(end: BoundedSshEnd): SshResolution {
  if (end.kind === 'failed') {
    return end.reason === 'cancelled'
      ? { outcome: 'cancelled' }
      : {
          outcome: 'failed',
          reason: end.reason === 'client_missing' ? 'client_missing' : 'config',
          diagnostic: end.diagnostic,
        };
  }
  if (end.stdoutOverflow)
    return {
      outcome: 'failed',
      reason: 'config',
      diagnostic: 'ssh -G wrote more than its output bound.',
    };
  const destination =
    end.code === 0
      ? parseResolvedDestination(end.stdout.toString('utf8'))
      : undefined;
  return destination === undefined
    ? { outcome: 'failed', reason: 'config', diagnostic: end.diagnostic }
    : { outcome: 'resolved', destination };
}

function outcomeFromEnd(end: BoundedSshEnd): SshRunOutcome {
  return end.kind === 'failed'
    ? { outcome: 'failed', reason: end.reason, diagnostic: end.diagnostic }
    : {
        outcome: 'ended',
        stdout: end.stdout,
        stdoutOverflow: end.stdoutOverflow,
        diagnostic: end.diagnostic,
        code: end.code,
        signal: end.signal,
      };
}

export function createSshClient(options: SshClientOptions): SshClient {
  const spawn = options.spawn ?? spawnSshProcess;
  let configFile = options.configFile;

  /** The generated configuration, written once per process on first use. */
  function configPath(): string {
    configFile ??= createSshConfigFile({
      knownHostsFile: options.ssh.knownHostsFile,
      identityFile: options.ssh.identityFile,
      identityAgent: options.ssh.identityAgent,
      includeFile: options.ssh.configFile ?? defaultSshConfigFile(),
    });
    return configFile.path;
  }

  return {
    sshConfigText: () => configFile?.text,
    resolve: async (request) =>
      resolvedFromEnd(
        await runBoundedSsh(spawn, resolveArgs(configPath(), request), {
          maxStdoutBytes:
            options.resolutionOutputBytes ?? SSH_RESOLUTION_OUTPUT_BYTES,
          deadlineMs:
            options.resolutionDeadlineMs ?? SSH_RESOLUTION_DEADLINE_MS,
          ...(request.signal !== undefined && { signal: request.signal }),
        }),
      ),
    run: async (request) =>
      outcomeFromEnd(
        await runBoundedSsh(spawn, runArgs(configPath(), request), {
          maxStdoutBytes: request.maxStdoutBytes,
          deadlineMs: request.deadlineMs,
          ...(request.signal !== undefined && { signal: request.signal }),
          ...(request.input !== undefined && { input: request.input }),
        }),
      ),
    dispose: () => {
      configFile?.dispose();
      configFile = undefined;
    },
  };
}

/** The message an `ssh_unavailable` result carries for one reason. */
export function sshUnavailableMessage(
  reason: SshOperationFailureReason,
): string {
  return `The SSH operation failed (${reason}).`;
}
