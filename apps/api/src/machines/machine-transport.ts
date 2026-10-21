/**
 * The byte-level link to one Machine (remote-machines design D1/D3). A
 * transport is what the session frames ride on: SSH's stdio pipes in
 * production, an in-process peer in tests. It reports the raw facts of how the
 * link ended (exit status, bounded stderr) so the session can classify them
 * into the one closed set of failure reasons the status column accepts.
 *
 * Production link: `ssh -F <generated> -T -- <destination> llame-machine serve
 * --stdio`. `-F` carries the generated safety block (ssh-config.ts) and the
 * `Include` of the operator's own configuration, and it propagates to jump
 * hosts (the implicit jump command carries it), unlike command-line `-o`/`-i`.
 */

import type { Readable, Writable } from 'node:stream';

import type { MachinesConfig } from '../instance-config/machines-config';
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

export type MachineSshTransportFactoryOptions = {
  readonly ssh: MachinesConfig['ssh'];
  /** Test seam: where the link process comes from. */
  readonly spawn?: SshSpawn;
  /** Test seam: a pre-made generated configuration file. */
  readonly configFile?: SshConfigFile;
};

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
  let configFile = options.configFile;

  function path(): string {
    configFile ??= createSshConfigFile({
      knownHostsFile: options.ssh.knownHostsFile,
      identityFile: options.ssh.identityFile,
      includeFile: options.ssh.configFile ?? defaultSshConfigFile(),
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
          sshDestination(request.destination),
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
