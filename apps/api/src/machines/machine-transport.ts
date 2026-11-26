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

import type { Readable, Writable } from 'node:stream';
import type { Transport } from '@connectrpc/connect';
import { collectSshDiagnostic, type SshProcess } from '../ssh/ssh-process';
import type {
  MachineRequestHandler,
  MachineStreamHandler,
} from './machine-session';

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
