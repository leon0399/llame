/**
 * Owner scope for `ssh://` operations (ssh-locator task 6.2 and the "Hub state
 * for ssh operations stays isolated for each owner" requirement): two real
 * users, a real Postgres with its row-level security, and a real command run
 * over `ssh://` on the sshd fixture.
 *
 * The point is the durable ledger, not the wire: user A's remote command
 * records the unbound native attempt and its result under A's Run, and user
 * B's reads — the Run event cursor, the native-attempt probes the tool path
 * uses, and the Run lookup — return none of A's rows. The attempt probes carry
 * no user argument of their own, so row-level security is what stops them.
 *
 * Requires a Docker daemon, Postgres provisioned through
 * `TEST_DATABASE_URL`, and the OpenSSH client tools.
 */

import { randomUUID } from 'node:crypto';

import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunsRepository, RunEventsRepository } from '../runs/runs-repository';
import {
  startMachineSshd,
  type MachineSshd,
} from '../testing/machine-sshd/machine-sshd';
import { createSshClient, type SshClient } from './ssh-client';
import { bashTool } from '../tools/bash';
import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
import { runTool } from '../tools/runner';
import { type ToolContext } from '../tools/types';

/** Enough for the containers' first SSH handshake. */
const CALL_TIMEOUT_SECONDS = 30;

const policy = compileToolPermissionMap(
  { bash: { allow: true } },
  'isolation-policy',
);

/** The Run identity and its delivery sequence, as a worker would hold them. */
type SeededRun = {
  readonly chatId: string;
  readonly runId: string;
  readonly deliverySequence: number;
};

describe('ssh operations stay in their owner scope', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  let fixture: MachineSshd;
  let client: SshClient;
  const userA = randomUUID();
  const userB = randomUUID();
  let runA: SeededRun;
  let runB: SeededRun;
  const toolCallA = randomUUID();

  async function seedRun(userId: string, title: string): Promise<SeededRun> {
    return tenantDb.runAs(userId, async (tx) => {
      const chatId = randomUUID();
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: userId,
        title,
      });
      const message = await new MessagesRepository(tx).create({
        chatId,
        senderUserId: userId,
        role: 'user',
        parts: [{ type: 'text', text: 'Run the remote command.' }],
      });
      const runs = new RunsRepository(tx);
      const run = await runs.create({
        chatId,
        userId,
        messageId: message.id,
        modelId: 'ssh-isolation',
      });
      await runs.markStarted(run.id, userId);
      const started = await new RunEventsRepository(tx).append(
        run.id,
        'run.started',
      );
      return { chatId, runId: run.id, deliverySequence: started.sequence };
    });
  }

  function context(userId: string, run: SeededRun): ToolContext {
    return {
      userId,
      chatId: run.chatId,
      runId: run.runId,
      nativeDeliverySequence: run.deliverySequence,
      toolCallId: toolCallA,
      tenantDb,
      permissionPolicy: policy,
      sshClient: client,
    };
  }

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error('Integration database was not provisioned.');
    sql = postgres(url, { max: 2 });
    tenantDb = new TenantDbService(drizzle(sql, { schema }));
    await sql`INSERT INTO users (id, name, email) VALUES (${userA}, 'User A', ${`${userA}@test.com`}), (${userB}, 'User B', ${`${userB}@test.com`})`;

    fixture = await startMachineSshd();
    const connection = fixture.ssh();
    client = createSshClient({
      ssh: {
        knownHostsFile: connection.knownHostsFile,
        identityFile: connection.identityFile,
        configFile: connection.includeFile,
      },
    });
  }, 600_000);

  afterAll(async () => {
    client?.dispose();
    await fixture?.dispose();
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${userA}, ${userB})`;
      await sql.end();
    }
  });

  beforeEach(async () => {
    runA = await seedRun(userA, 'User A remote bash');
    runB = await seedRun(userB, 'User B local work');
  });

  it('records user A’s attempt and result under A, and shows B none of them', async () => {
    const result = await runTool(
      bashTool,
      { command: 'id -un', cwd: 'ssh://box/tmp' },
      context(userA, runA),
      CALL_TIMEOUT_SECONDS,
    );
    // The submitted text is what ran: `id -un` prints the fixture's login
    // user (`User box` in the included configuration), so a script that
    // evaluated anything else would not produce this output.
    expect(result).toMatchObject({
      status: 'success',
      exitCode: 0,
      stdout: 'box\n',
    });

    // A's own ledger: the attempt is durable before SSH, and exactly one
    // result follows it.
    const ownEvents = await tenantDb.runAs(userA, (tx) =>
      new RunEventsRepository(tx).listByRunId(runA.runId, userA),
    );
    expect(ownEvents.map((event) => event.eventType)).toEqual([
      'run.started',
      'native.attempt',
      'native.result',
    ]);
    // The attempt carries the canonical locator the permission decided on, so
    // it is not the submitted spelling: the resolved user and port appear.
    const attempt = ownEvents.find(
      (event) => event.eventType === 'native.attempt',
    );
    expect(attempt?.payload).toMatchObject({
      toolCallId: toolCallA,
      operation: 'bash',
    });
    // The path is the canonical locator, not the submitted spelling: the
    // resolved user and port appear. Read it through the payload's JSON, since
    // the column is typed as the event payload union.
    expect(JSON.stringify(attempt?.payload)).toMatch(
      /"path":"ssh:\/\/[^"/]+@box:\d+\/tmp"/u,
    );
    await expect(
      tenantDb.runAs(userA, (tx) =>
        new NativeFilesRepository(tx).hasMutation(runA.runId),
      ),
    ).resolves.toBe(true);
    // A's own probe returns the settled outcome for the same call: the fence a
    // redelivered Run relies on, so B's empty probe below is not hiding a
    // probe that never returns anything.
    await expect(
      tenantDb.runAs(userA, (tx) =>
        new NativeFilesRepository(tx).priorOutcome(runA.runId, toolCallA),
      ),
    ).resolves.toMatchObject({ status: 'success' });

    // B's reads of that Run: no events, no attempt row, no settled outcome,
    // and no Run at all. The two attempt probes take no user argument, so the
    // Run's owner scope is what keeps them empty.
    await expect(
      tenantDb.runAs(userB, (tx) =>
        new RunEventsRepository(tx).listByRunId(runA.runId, userB),
      ),
    ).resolves.toEqual([]);
    await expect(
      tenantDb.runAs(userB, (tx) =>
        new NativeFilesRepository(tx).hasMutation(runA.runId),
      ),
    ).resolves.toBe(false);
    await expect(
      tenantDb.runAs(userB, (tx) =>
        new NativeFilesRepository(tx).priorOutcome(runA.runId, toolCallA),
      ),
    ).resolves.toBeUndefined();
    await expect(
      tenantDb.runAs(userB, (tx) =>
        new RunsRepository(tx).findById(runA.runId, userB),
      ),
    ).resolves.toBeUndefined();

    // B's own Run is unchanged: the ssh attempt never lands under B, even
    // with the same tool-call id in hand.
    const foreignEvents = await tenantDb.runAs(userB, (tx) =>
      new RunEventsRepository(tx).listByRunId(runB.runId, userB),
    );
    expect(foreignEvents.map((event) => event.eventType)).toEqual([
      'run.started',
    ]);
    await expect(
      tenantDb.runAs(userB, (tx) =>
        new NativeFilesRepository(tx).priorOutcome(runB.runId, toolCallA),
      ),
    ).resolves.toBeUndefined();
  });
});
