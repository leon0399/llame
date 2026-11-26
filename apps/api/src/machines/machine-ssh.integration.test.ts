/**
 * The Machine SSH transport against two real sshd containers (remote-machines
 * task 4.2). The hub side is the production path end to end: a real
 * `MachineConnector`, the real `createMachineSshTransportFactory` spawning the
 * system `ssh` with the generated safety block plus an included configuration,
 * a hub key pinned on both the jump host and the box, and the box running the
 * bundled daemon behind the `authorized_keys` forced command.
 *
 * Scenarios cover SSH transport and forced-command behavior, including that
 * daemon-held jobs keep running after a link is lost and can be stopped from
 * a new session.
 *
 * Requires a Docker daemon and the OpenSSH client tools; see the fixture for
 * how a missing one fails loudly instead of skipping.
 */

import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import {
  type JsonValue,
  type MachineMethod,
  type MachineMethodParams,
} from '@workspace/machine-protocol';

import {
  MACHINE_SSHD_ALIAS,
  MACHINE_SSHD_NAME,
  MACHINE_SSHD_NOTES_CONTENT,
  MACHINE_SSHD_NOTES_FILE,
  MACHINE_SSHD_ROOT,
  startMachineSshd,
  type MachineSshd,
  type MachineSshdConnection,
} from '../testing/machine-sshd/machine-sshd';

import { MachineConnector } from './machine-connector.service';
import { readFsReadResult } from './machine-results';
import { MachineUnavailableError } from './machine-session-errors';
import type { MachineTransport } from './machine-transport';
import { createMachineSshTransportFactory } from './machine-ssh-transport';

const HUB_VERSION = '0.0.0-machine-ssh-test';
const ENVELOPE = { budgetMs: 60_000 };

/**
 * The generated safety block allows `ConnectTimeout 10` per hop, so a hop that
 * drops packets must fail well inside this; a connection that merely hung would
 * not.
 */
const CONNECT_TIMEOUT_ALLOWANCE_MS = 30_000;
const LONG_BASH_SECONDS = 300;

const PROCESS_POLL_MS = 200;
const PROCESS_POLL_TIMEOUT_MS = 15_000;

describe('Machine SSH transport over a jump host (remote-machines)', () => {
  let fixture: MachineSshd;

  beforeAll(async () => {
    fixture = await startMachineSshd();
  }, 600_000);

  afterEach(async () => {
    // Whichever scenario ran, the next one starts whole: no drop rule left in
    // the bastion and a box that is running.
    await fixture.restorePackets(fixture.bastion);
    await fixture.ensureRunning(fixture.box);
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it('resolves the included alias through the bastion and runs roots.list, fs.read, and proc.bash', async () => {
    const harness = connect(fixture.connection());

    try {
      await expect(
        request(harness, 'roots.list', { envelope: ENVELOPE }),
      ).resolves.toEqual({
        roots: [MACHINE_SSHD_ROOT],
      });

      const read = readFsReadResult(
        await request(harness, 'fs.read', {
          envelope: ENVELOPE,
          path: MACHINE_SSHD_NOTES_FILE,
          options: { displayPrefix: `machine://${MACHINE_SSHD_NAME}` },
        }),
      );

      if (read?.status !== 'success' || read.kind !== 'file')
        throw new Error(
          `fs.read did not return the file: ${JSON.stringify(read)}`,
        );
      // The rendered read carries line numbers, so the file's own bytes are
      // what the content must still hold.
      expect(read.content).toContain(MACHINE_SSHD_NOTES_CONTENT.trim());
      await expect(
        request(harness, 'proc.bash', { envelope: ENVELOPE, command: 'pwd' }),
      ).resolves.toMatchObject({
        status: 'success',
        exitCode: 0,
        stdout: `${MACHINE_SSHD_ROOT}\n`,
      });
      // All three rode one SSH process: the box is reached once, not per call.
      expect(harness.transports).toHaveLength(1);
    } finally {
      harness.dispose();
    }
  });

  it('refuses a jump-host key that is missing from the pinned file, sending nothing', async () => {
    const harness = connect(fixture.connection({ pinBastion: false }));

    try {
      const error = refusal(
        await request(harness, 'roots.list', { envelope: ENVELOPE }).catch(
          rejection,
        ),
      );

      expect(error).toBeInstanceOf(MachineUnavailableError);
      expect(error.reason).toBe('host_key_mismatch');
      // `sent` is the hub's own count of frames written: nothing reached the box.
      expect(error.sent).toBe(false);
    } finally {
      harness.dispose();
    }
  });

  it('cannot weaken host-key checking or share a connection from the included configuration', async () => {
    const unpinned = connect(
      fixture.connection({ pinBastion: false, weaken: true }),
    );

    try {
      const error = refusal(
        await request(unpinned, 'roots.list', { envelope: ENVELOPE }).catch(
          rejection,
        ),
      );

      expect(error.reason).toBe('host_key_mismatch');
      expect(error.sent).toBe(false);
    } finally {
      unpinned.dispose();
    }

    // The same included configuration still reaches a pinned Machine, and the
    // `ControlMaster auto` it asks for never creates a socket.
    const pinned = connect(fixture.connection({ weaken: true }));

    try {
      await expect(
        request(pinned, 'roots.list', { envelope: ENVELOPE }),
      ).resolves.toEqual({
        roots: [MACHINE_SSHD_ROOT],
      });
      expect(pinned.transports).toHaveLength(1);
      expect(readdirSync(fixture.controlDirectory)).toEqual([]);
    } finally {
      pinned.dispose();
    }
  });

  it('fails within the connect timeout when a hop silently drops packets', async () => {
    const harness = connect(fixture.connection());

    try {
      await fixture.dropPackets(fixture.bastion);
      const started = Date.now();

      const error = refusal(
        await request(harness, 'roots.list', { envelope: ENVELOPE }).catch(
          rejection,
        ),
      );

      const elapsed = Date.now() - started;
      expect(error.reason).toBe('unreachable');
      expect(error.sent).toBe(false);
      expect(elapsed).toBeLessThan(CONNECT_TIMEOUT_ALLOWANCE_MS);

      // The same hub reaches the Machine again once the hop stops dropping.
      await fixture.restorePackets(fixture.bastion);
      await expect(
        request(harness, 'roots.list', { envelope: ENVELOPE }),
      ).resolves.toEqual({
        roots: [MACHINE_SSHD_ROOT],
      });
    } finally {
      harness.dispose();
    }
  });

  it('reports the Machine unreachable while the box is stopped, and recovers when it runs again', async () => {
    const harness = connect(fixture.connection());

    try {
      await expect(
        request(harness, 'roots.list', { envelope: ENVELOPE }),
      ).resolves.toEqual({
        roots: [MACHINE_SSHD_ROOT],
      });

      fixture.stopForRestart(fixture.box);

      const error = refusal(
        await request(harness, 'roots.list', { envelope: ENVELOPE }).catch(
          rejection,
        ),
      );

      expect(['unreachable', 'session_lost']).toContain(error.reason);

      // The stop took a live session with it, so whether this request's frame
      // had already gone out is a race; `sent` reports which side of it the
      // request landed on, and only a sent request has an unknown outcome.
      if (error.sent) expect(error.reason).toBe('session_lost');

      await fixture.startForRestart(fixture.box);
      await expect(
        request(harness, 'roots.list', { envelope: ENVELOPE }),
      ).resolves.toEqual({
        roots: [MACHINE_SSHD_ROOT],
      });
    } finally {
      harness.dispose();
    }
  });

  it('keeps a daemon job running after its SSH session is lost', async () => {
    const connection = fixture.connection();
    const harness = connect(connection);
    const command = `sleep ${String(LONG_BASH_SECONDS)}`;
    const jobId = randomBytes(16).toString('hex');
    const owner = 'hub';

    try {
      const session = await harness.connector.jobsClient(MACHINE_SSHD_NAME);

      const created = await session.client.createJob(
        { jobId, owner, command },
        session.callOptions(),
      );

      expect(created.result.case).toBe('job');
      await waitForBoxProcess(fixture, command, true);

      const link = harness.transports.at(-1);

      if (link === undefined)
        throw new Error('The Machine link was never opened.');
      link.close();
      await waitForBoxProcess(fixture, command, true);
    } finally {
      harness.dispose();
      await stopRemoteJob(connection, jobId, owner);
    }

    await waitForBoxProcess(fixture, command, false);
  });

  it('carries two concurrent requests over one SSH process', async () => {
    const harness = connect(fixture.connection());

    try {
      const slow = request(harness, 'proc.bash', {
        envelope: ENVELOPE,
        command: 'sleep 2',
      });

      await expect(
        request(harness, 'roots.list', { envelope: ENVELOPE }),
      ).resolves.toEqual({
        roots: [MACHINE_SSHD_ROOT],
      });
      // The second call did not wait for the first, and did not open a link.
      expect(sshProcessCount()).toBe(1);
      await expect(slow).resolves.toMatchObject({
        status: 'success',
        exitCode: 0,
      });
      expect(harness.transports).toHaveLength(1);
    } finally {
      harness.dispose();
    }
  });

  it('holds the forced command: an SSH exec request cannot run an arbitrary command', () => {
    const connection = fixture.connection();

    const result = spawnSync(
      'ssh',
      [
        '-F',
        connection.sshConfig.path,
        '-T',
        '--',
        MACHINE_SSHD_ALIAS,
        'id',
      ],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(126);
    expect(result.stderr).toContain(
      'machine-sshd: refused an unsupported SSH command',
    );
  });
});

type Harness = {
  readonly connector: MachineConnector;
  /** Every link the real factory opened, in order. */
  readonly transports: Array<MachineTransport>;
  dispose(): void;
};

/** The production connector over the real SSH factory, with the links counted. */
function connect(connection: MachineSshdConnection): Harness {
  const ssh = createMachineSshTransportFactory({
    ssh: connection.machines.ssh,
  });

  const transports: Array<MachineTransport> = [];

  const connector = new MachineConnector({
    machines: connection.machines,
    hubVersion: HUB_VERSION,
    bindIdentity: () => Promise.resolve('match'),
    transportFactory: {
      open: (transportRequest) => {
        const transport = ssh.open(transportRequest);
        transports.push(transport);

        return transport;
      },
    },
  });

  return {
    connector,
    transports,
    dispose: () => {
      connector.onModuleDestroy();
      ssh.dispose();
    },
  };
}

/** One request to the configured Machine, carrying the suite's budget. */
function request<M extends MachineMethod>(
  harness: Harness,
  method: M,
  params: MachineMethodParams[M],
): Promise<JsonValue> {
  return harness.connector.request(MACHINE_SSHD_NAME, method, params, {
    budgetMs: ENVELOPE.budgetMs,
  });
}

function rejection(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** The refusal a call failed with, for assertions. */
function refusal(error: unknown): MachineUnavailableError {
  if (error instanceof MachineUnavailableError) return error;
  throw error;
}

/** Whether a process whose command line holds `marker` is running in the box. */
async function waitForBoxProcess(
  sshd: MachineSshd,
  marker: string,
  present: boolean,
): Promise<void> {
  const deadline = Date.now() + PROCESS_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const listing = await sshd.execIn(sshd.box, ['ps', '-eo', 'args']);

    if (listing.stdout.includes(marker) === present) return;
    await delay(PROCESS_POLL_MS);
  }

  throw new Error(
    `The box never ${present ? 'started' : 'stopped'} a process matching "${marker}".`,
  );
}

/** The `ssh` children of this test process that carry a Machine session. */
function sshProcessCount(): number {
  const listing = execFileSync(
    'ps',
    ['-o', 'args=', '--ppid', String(process.pid)],
    {
      encoding: 'utf8',
    },
  );

  return listing
    .split('\n')
    .filter(
      (line) => line.includes(' -L ') && line.includes('/llame-machine-ssh-'),
    ).length;
}

async function stopRemoteJob(
  connection: MachineSshdConnection,
  jobId: string,
  owner: string,
): Promise<void> {
  const harness = connect(connection);

  try {
    const session = await harness.connector.jobsClient(MACHINE_SSHD_NAME);

    await session.client.cancelJob(
      { requestId: jobId, jobId, owner },
      session.callOptions(),
    );
  } finally {
    harness.dispose();
  }
}

