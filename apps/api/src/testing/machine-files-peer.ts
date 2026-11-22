/**
 * A real `MachineConnector` whose own Machine is the actual daemon, run in
 * process (host-as-machine layer 3). After that layer the host file tools go
 * through the Machine surface like any other Machine, so a tool test that wants
 * the daemon's real behaviour — root guard, media sniffing, byte streaming —
 * needs a daemon it can reach without SSH. The transport is two `PassThrough`s
 * into `apps/machine/src/serve.ts`, the entry the `llame-machine` bundle runs,
 * so a test asserts the daemon's behaviour instead of a copy of it.
 *
 * Deliberately under `src/testing/`: scaffolding, excluded from coverage and
 * mutation, never imported by production code.
 */

import { PassThrough } from 'node:stream';

import { createLineFramer, decodeFrame } from '@workspace/machine-protocol';
import { serveMachine, type SessionEndReason } from 'machine/src/serve';

import { MachineConnector } from '../machines/machine-connector.service';
import {
  type MachineLinkEnd,
  type MachineTransport,
  type MachineTransportFactory,
} from '../machines/machine-transport';
import { DEFAULT_LOCAL_MACHINE_NAME } from './local-machine';

/** A fixed identity, so an in-process daemon reads and writes no real config. */
const TEST_INSTANCE_ID = '00000000-0000-4000-8000-000000000001';
const TEST_BUILD_ID = '000000000000';

/** One in-process daemon session, as the hub side saw it. */
export type MachineFilesSession = {
  /** Every method the hub sent, in order. */
  readonly requests: ReadonlyArray<string>;
};

export type MachineFilesPeer = {
  readonly sessions: ReadonlyArray<MachineFilesSession>;
  session(index: number): Promise<MachineFilesSession>;
};

export type MachineFilesPeerOptions = {
  /** `machines.local` and `machines.default`, both this name. */
  readonly name?: string;
  /** The registered roots; a path outside all of them is refused. Default `/`. */
  readonly roots?: ReadonlyArray<string>;
  /** Called for each request as it leaves the hub, before the daemon answers. */
  readonly onRequest?: (method: string) => void;
};

export type MachineFilesConnector = MachineConnector & {
  /** The daemon side: the sessions it served and the methods each saw. */
  readonly peer: MachineFilesPeer;
};

/** Forward every hub frame to the daemon, naming each method it asks for. */
function observeRequests(input: {
  readonly observing: PassThrough;
  readonly fromHub: PassThrough;
  readonly requests: Array<string>;
  readonly onRequest: ((method: string) => void) | undefined;
}): void {
  const framer = createLineFramer();

  input.observing.on('data', (chunk: Buffer) => {
    for (const event of framer.push(chunk)) {
      if (event.kind !== 'line') continue;
      const decoded = decodeFrame(event.line);

      if (!decoded.ok) continue;
      const message = decoded.frame.m;

      if (!('method' in message)) continue;
      input.requests.push(message.method);
      input.onRequest?.(message.method);
    }

    input.fromHub.write(chunk);
  });
}

/** How the link ended once the daemon stopped, for the session's classifier. */
function daemonLinkEnd(
  done: Promise<SessionEndReason>,
  closedByHub: () => boolean,
): Promise<MachineLinkEnd> {
  return done.then((reason) => ({
    code: closedByHub() ? null : 0,
    signal: null,
    diagnostic: reason === 'closed' || reason === 'input_ended' ? '' : reason,
    closedByHub: closedByHub(),
  }));
}

/**
 * One daemon session over two pipes. The hub side counts the methods it sends,
 * so a test can prove a request left the process instead of a local shortcut.
 */
function daemonTransport(options: {
  readonly roots: ReadonlyArray<string>;
  readonly requests: Array<string>;
  readonly onRequest: ((method: string) => void) | undefined;
}): MachineTransport {
  const fromHub = new PassThrough();
  const toHub = new PassThrough();
  const observing = new PassThrough();
  let closedByHub = false;

  const daemon = serveMachine(fromHub, toHub, {
    roots: [...options.roots],
    instanceId: TEST_INSTANCE_ID,
    buildId: TEST_BUILD_ID,
    heartbeatIntervalMs: 600_000,
  });

  observeRequests({
    observing,
    fromHub,
    requests: options.requests,
    onRequest: options.onRequest,
  });

  return {
    input: toHub,
    output: observing,
    close: () => {
      if (closedByHub) return;
      closedByHub = true;
      observing.end();
      fromHub.end();
      daemon.stop('closed');
      toHub.destroy();
    },
    ended: daemonLinkEnd(daemon.done, () => closedByHub),
  };
}

/**
 * A transport factory that answers every Machine this connector names with a
 * fresh in-process daemon session, for a test that supplies its own
 * `machines` configuration.
 */
export function machineFilesTransportFactory(
  options: Pick<MachineFilesPeerOptions, 'roots' | 'onRequest'> = {},
): MachineTransportFactory {
  const roots = options.roots ?? ['/'];

  return {
    open: () =>
      daemonTransport({
        roots,
        requests: [],
        onRequest: options.onRequest,
      }),
  };
}

/**
 * A connector whose own Machine is a real daemon in process, so a tool test
 * exercises real reads and mutations after the host file family moved onto the
 * Machine surface.
 */
export function machineFilesConnector(
  options: MachineFilesPeerOptions = {},
): MachineFilesConnector {
  const name = options.name ?? DEFAULT_LOCAL_MACHINE_NAME;
  const roots = options.roots ?? ['/'];
  const sessions: Array<MachineFilesSession> = [];
  const waiters: Array<() => void> = [];

  const factory: MachineTransportFactory = {
    open: () => {
      const requests: Array<string> = [];
      sessions.push({ requests });

      for (const wake of waiters.splice(0)) wake();

      return daemonTransport({ roots, requests, onRequest: options.onRequest });
    },
  };

  const connector = new MachineConnector({
    machines: { local: name, default: name, hosts: { [name]: {} } },
    hubVersion: '0.0.0-machine-files-test',
    bindIdentity: () => Promise.resolve('match'),
    localTransportFactory: factory,
  });

  return Object.assign(connector, {
    peer: {
      sessions,
      session: async (index: number) => {
        while (sessions.length <= index) {
          const { promise, resolve } = Promise.withResolvers<void>();

          waiters.push(resolve);
          await promise;
        }

        const session = sessions[index];

        if (session === undefined) throw new Error('the daemon has no session');

        return session;
      },
    } satisfies MachineFilesPeer,
  });
}
