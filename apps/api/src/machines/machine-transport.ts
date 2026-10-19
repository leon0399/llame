/**
 * The byte-level link to one Machine (remote-machines design D1/D3). A
 * transport is what the session frames ride on: SSH's stdio pipes in
 * production, an in-process peer in tests. It reports the raw facts of how the
 * link ended (exit status, bounded stderr) so the session can classify them
 * into the one closed set of failure reasons the status column accepts.
 *
 * Production link: `ssh -F <generated> -T -- <destination> llame-machine serve
 * --stdio`. `-F` carries the generated safety block (machine-ssh-config.ts) and
 * the `Include` of the operator's own configuration, and it propagates to jump
 * hosts (the implicit jump command carries it), unlike command-line `-o`/`-i`.
 */

import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

import type { MachinesConfig } from '../instance-config/machines-config';

import {
  createMachineSshConfigFile,
  defaultMachineSshConfigFile,
  type MachineSshConfigFile,
} from './machine-ssh-config';
import type { MachineFailureReason } from './machines-status';

/** The bounded stderr text a link keeps for classification and the operator. */
export const LINK_DIAGNOSTIC_BYTES = 8192;

/** How the link ended; `diagnostic` is the link process's own stderr. */
export type MachineLinkEnd = {
  readonly code: number | null;
  readonly signal: string | null;
  readonly diagnostic: string;
  /** True when llame ended the link itself (idle close or shutdown). */
  readonly closedByHub: boolean;
};

export type MachineTransport = {
  /** Frames from the Machine. */
  readonly input: Readable;
  /** Frames to the Machine. */
  readonly output: Writable;
  /** End the link. Idempotent. */
  close(): void;
  /** Resolves once the link has ended, however it ended. */
  readonly ended: Promise<MachineLinkEnd>;
};

export type MachineTransportRequest = {
  readonly name: string;
  readonly destination: string;
};

/** The seam the session manager opens a link through (tests inject a peer). */
export type MachineTransportFactory = {
  open(request: MachineTransportRequest): MachineTransport;
};

/**
 * The smallest child-process surface a link needs, so a test can drive the
 * factory's argv and failure paths without an `ssh` binary.
 */
export type MachineLinkProcess = {
  readonly stdout: Readable;
  readonly stdin: Writable;
  readonly stderr: Readable;
  kill(): void;
  onError(handler: (error: Error) => void): void;
  onClose(handler: (code: number | null, signal: string | null) => void): void;
};

export type MachineLinkSpawn = (
  command: string,
  args: ReadonlyArray<string>,
) => MachineLinkProcess;

const SSH_HOST_KEY_MISMATCH = /host key verification failed/iu;
const SSH_AUTH_FAILED = /permission denied/iu;

/**
 * The reason a link failure maps to. Once the handshake completed the link was
 * established, so an end after that is a lost session, whatever ssh prints.
 * Before it, ssh's own message decides: only a pinned-key refusal is a host-key
 * mismatch, only a credential refusal is an auth failure, and everything else
 * (an unknown host, a black-holed hop, a missing remote command) is
 * unreachable.
 */
export function classifyLinkFailure(
  established: boolean,
  diagnostic: string,
): MachineFailureReason {
  if (established) return 'session_lost';
  if (SSH_HOST_KEY_MISMATCH.test(diagnostic)) return 'host_key_mismatch';
  if (SSH_AUTH_FAILED.test(diagnostic)) return 'auth_failed';
  return 'unreachable';
}

/** Accumulates stderr to a bound, keeping the head (where ssh states its why). */
function collectDiagnostic(stderr: Readable): () => string {
  let text = '';
  stderr.setEncoding('utf8');
  stderr.on('data', (chunk: string) => {
    if (Buffer.byteLength(text) < LINK_DIAGNOSTIC_BYTES) text += chunk;
  });
  stderr.on('error', () => undefined);
  return () => text;
}

/** Wrap a spawned link process as a transport. */
export function createProcessTransport(
  link: MachineLinkProcess,
): MachineTransport {
  const diagnostic = collectDiagnostic(link.stderr);
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

const spawnLinkProcess: MachineLinkSpawn = (command, args) => {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  return {
    stdout: child.stdout,
    stdin: child.stdin,
    stderr: child.stderr,
    kill: () => {
      child.kill();
    },
    onError: (handler) => child.on('error', handler),
    onClose: (handler) => child.on('close', handler),
  };
};

export type MachineSshTransportFactoryOptions = {
  readonly ssh: MachinesConfig['ssh'];
  /** Test seam: where the link process comes from. */
  readonly spawn?: MachineLinkSpawn;
  /** Test seam: a pre-made generated configuration file. */
  readonly configFile?: MachineSshConfigFile;
};

export type MachineSshTransportFactory = MachineTransportFactory & {
  /** The generated configuration's text, or undefined when none was written. */
  readonly sshConfigText: () => string | undefined;
  /** Remove the generated configuration's private directory. */
  dispose(): void;
};

/**
 * The production factory: one generated SSH configuration per process, written
 * on first use, and one `ssh` process per session.
 */
export function createMachineSshTransportFactory(
  options: MachineSshTransportFactoryOptions,
): MachineSshTransportFactory {
  const spawnLink = options.spawn ?? spawnLinkProcess;
  let configFile = options.configFile;

  function path(): string {
    configFile ??= createMachineSshConfigFile({
      knownHostsFile: options.ssh.knownHostsFile,
      identityFile: options.ssh.identityFile,
      includeFile: options.ssh.configFile ?? defaultMachineSshConfigFile(),
    });
    return configFile.path;
  }

  return {
    sshConfigText: () => configFile?.text,
    open: (request) =>
      createProcessTransport(
        spawnLink('ssh', [
          '-F',
          path(),
          '-T',
          '--',
          request.destination,
          'llame-machine',
          'serve',
          '--stdio',
        ]),
      ),
    dispose: () => {
      configFile?.dispose();
      configFile = undefined;
    },
  };
}
