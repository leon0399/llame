import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { type PgTransactionConfig } from 'drizzle-orm/pg-core';
import { isRecord, isString } from '@workspace/runtime-safety';

import { TenantDbService, type Db } from '../db/tenant-db.service';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunsRepository } from '../runs/runs-repository';
import { RunRowFenceRepository } from '../runs/run-row-fence.repository';
import { createUser } from '../runs/worker-harness';
import { waitFor } from '../testing/support';
import {
  answer,
  call,
  useSegmentsFixture,
} from '../testing/run-segments.test-fixture';
import { ChatJobsRepository } from './chat-jobs.repository';

if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    'bash-promotion-recovery.integration.test.ts requires the integration database',
  );

vi.setConfig({ testTimeout: 60_000 });

describe('host bash promotion and recovery database arbitration', () => {
  const fx = useSegmentsFixture('bash-promotion-recovery', {
    allowedTools: ['bash'],
    nativeExecutorId: 'bash-promotion-recovery-host',
  });

  it('reconciles a committed promotion after its transaction acknowledgement is lost', async () => {
    const seeded = await fx.seed();
    const invocationFile = join(fx.directory, `invocations-${randomUUID()}`);
    const pidFile = join(fx.directory, `pid-${randomUUID()}`);
    await fx.launch(seeded, [
      call('command', 'bash', {
        command: `printf 'invoked\\n' >> ${invocationFile}; echo $$ > ${pidFile}; printf 'ack-output\\n'; exec sleep 30`,
        cwd: fx.directory,
      }),
      answer('after lost promotion acknowledgement'),
    ]);

    await waitFor(
      () => readFile(pidFile, 'utf8').catch(() => undefined),
      10_000,
      'the managed command to start',
    );

    const run = await waitFor(
      async () => {
        const current = await fx.run(seeded.runId);

        const attempt = (await fx.events(seeded.runId)).find(
          (event) =>
            event.eventType === 'native.attempt' &&
            isRecord(event.payload) &&
            event.payload.toolCallId === 'command',
        );

        return current?.activeAttemptId && attempt ? current : undefined;
      },
      10_000,
      'the active command attempt',
    );

    const tenantDb = fx.harness.tenantDb;
    const originalTenantDb = new TenantDbService(fx.harness.db);
    let acknowledgementLost = false;

    const interceptPromotionAck: typeof tenantDb.runAs = async <T>(
      userId: string,
      callback: (tx: Db) => Promise<T>,
      config?: PgTransactionConfig,
    ): Promise<T> => {
      let committedPromotion = false;

      const result = await originalTenantDb.runAs<T>(
        userId,
        async (tx) => {
          const value = await callback(tx);

          if (isRecord(value) && value['kind'] === 'committed')
            committedPromotion = true;

          return value;
        },
        config,
      );

      if (committedPromotion) {
        acknowledgementLost = true;
        throw new Error(
          'Deliberately lost promotion transaction acknowledgement.',
        );
      }

      return result;
    };

    vi.spyOn(tenantDb, 'runAs').mockImplementation(interceptPromotionAck);

    try {
      await fx.storeItems(seeded.chatId, ['continue'], 'steer', seeded.runId);

      const completion = await waitFor(
        async () =>
          (await fx.events(seeded.runId)).find(
            (event) => event.eventType === 'tool.completed',
          ),
        10_000,
        'the reconciled promotion result',
      );

      if (!isRecord(completion.payload))
        throw new Error('The tool completion payload is invalid.');

      expect(acknowledgementLost).toBe(true);
      expect(completion.payload).toMatchObject({
        toolCallId: 'command',
        status: 'success',
      });

      const output = completion.payload['output'];

      if (!isRecord(output) || !isString(output['job']))
        throw new Error('The backgrounded job result is invalid.');

      expect(output['status']).toBe('success');
      expect(output['job']).toMatch(/^job:\/\/bash-\d+$/);

      const receipts = (await fx.events(seeded.runId)).filter(
        (event) =>
          event.eventType === 'native.result' &&
          isRecord(event.payload) &&
          event.payload.toolCallId === 'command',
      );

      expect(receipts).toHaveLength(1);

      expect(receipts[0]?.payload).toMatchObject({
        toolCallId: 'command',
        result: completion.payload.output,
      });

      const jobs = await fx.db((tx) =>
        new ChatJobsRepository(tx).listByChat(seeded.chatId, fx.userId),
      );

      expect(jobs).toHaveLength(1);

      const [job] = jobs;

      if (job === undefined) throw new Error('The promoted job is missing.');

      const stdout = await fx.db((tx) =>
        new ChatJobsRepository(tx).readOutput(fx.userId, job.id, 'stdout'),
      );

      expect(stdout.toString('utf8')).toContain('ack-output');
      expect(await readFile(invocationFile, 'utf8')).toBe('invoked\n');
      expect(run.activeAttemptId).toBeDefined();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('does not publish an observation while the receipt insert is blocked, then commits one matching job receipt', async () => {
    const seeded = await fx.seed();

    const pidFile = join(fx.directory, `pid-${randomUUID()}`);

    const launched = await fx.launch(seeded, [
      call('command', 'bash', {
        command: `echo $$ > ${pidFile}; printf 'receipt-output\\n'; exec sleep 30`,
        cwd: fx.directory,
      }),
      answer('after promotion'),
    ]);

    await waitFor(
      () => readFile(pidFile, 'utf8').catch(() => undefined),
      10_000,
      'the managed command to start',
    );
    await waitFor(
      async () =>
        (await fx.events(seeded.runId)).find(
          (event) =>
            event.eventType === 'native.attempt' &&
            isRecord(event.payload) &&
            event.payload.toolCallId === 'command',
        ),
      10_000,
      'the host command attempt to be recorded',
    );

    const activeRun = await waitFor(
      async () => {
        const run = await fx.run(seeded.runId);

        return run?.activeAttemptId ? run : undefined;
      },
      10_000,
      'the active run attempt',
    );

    const lockReady = Promise.withResolvers<void>();

    const releaseLock = Promise.withResolvers<void>();

    const runLock = fx.db(async (tx) => {
      const locked = await new RunRowFenceRepository(tx).lockHostPromotion(
        seeded.runId,
        fx.userId,
        activeRun.activeAttemptId!,
      );

      if (locked === undefined)
        throw new Error('Could not lock the active Run.');

      lockReady.resolve();
      await releaseLock.promise;
    });

    try {
      await lockReady.promise;
      await fx.storeItems(seeded.chatId, ['continue'], 'steer', seeded.runId);
      // Keep the real Run-row lock past the production 750 ms deadline;
      // fake timers cannot prove the promotion is blocked in PostgreSQL.
      await new Promise((resolve) => setTimeout(resolve, 900));

      expect(
        await fx.db((tx) =>
          new ChatJobsRepository(tx).listByChat(seeded.chatId, fx.userId),
        ),
      ).toHaveLength(0);
      const eventsBeforeUnlock = await fx.events(seeded.runId);
      expect(
        eventsBeforeUnlock.some(
          (event) => event.eventType === 'tool.completed',
        ),
      ).toBe(false);
      expect(
        eventsBeforeUnlock.some((event) => event.eventType === 'native.result'),
      ).toBe(false);
    } finally {
      releaseLock.resolve();
      await runLock;
    }

    const completion = await waitFor(
      async () =>
        (await fx.events(seeded.runId)).find(
          (event) => event.eventType === 'tool.completed',
        ),
      10_000,
      'the host promotion result after releasing the event-table lock',
    );

    const receipt = (await fx.events(seeded.runId)).find(
      (event) =>
        event.eventType === 'native.result' &&
        isRecord(event.payload) &&
        event.payload.toolCallId === 'command',
    );

    expect(completion.payload).toMatchObject({
      toolCallId: 'command',
      status: 'success',
      output: { status: 'success' },
    });

    if (!isRecord(completion.payload) || !isRecord(receipt?.payload)) {
      throw new Error('The promotion result or receipt has an invalid shape.');
    }

    if (
      !isRecord(completion.payload.output) ||
      !isString(completion.payload.output.job)
    ) {
      throw new Error('The promotion result has an invalid job handle.');
    }

    expect(completion.payload.output.job).toMatch(/^job:\/\/bash-\d+$/);

    expect(receipt.payload).toMatchObject({
      toolCallId: 'command',
      result: completion.payload.output,
    });

    const jobs = await fx.db((tx) =>
      new ChatJobsRepository(tx).listByChat(seeded.chatId, fx.userId),
    );

    expect(jobs).toHaveLength(1);

    const [job] = jobs;

    if (job === undefined) throw new Error('The promoted job is missing.');

    const stdout = await fx.db((tx) =>
      new ChatJobsRepository(tx).readOutput(fx.userId, job.id, 'stdout'),
    );

    expect(stdout.toString('utf8')).toContain('receipt-output');

    const eventTypes = await fx.types(seeded.runId);
    expect(eventTypes.filter((type) => type === 'native.result')).toHaveLength(
      1,
    );
    expect(launched.runId).toBe(seeded.runId);
  });

  it('keeps the recovery receipt when recovery commits before a delayed real promotion', async () => {
    const seeded = await fx.seed();
    const pidFile = join(fx.directory, `pid-${randomUUID()}`);
    await fx.launch(seeded, [
      call('command', 'bash', {
        command: `echo $$ > ${pidFile}; exec sleep 30`,
        cwd: fx.directory,
      }),
      answer('after recovered promotion'),
    ]);

    await waitFor(
      () => readFile(pidFile, 'utf8').catch(() => undefined),
      10_000,
      'the managed command to start',
    );

    const run = await waitFor(
      async () => {
        const current = await fx.run(seeded.runId);

        const attempt = (await fx.events(seeded.runId)).find(
          (event) =>
            event.eventType === 'native.attempt' &&
            isRecord(event.payload) &&
            event.payload.toolCallId === 'command',
        );

        return current?.activeAttemptId && attempt ? current : undefined;
      },
      10_000,
      'the active command attempt',
    );

    const recoveredResult = {
      status: 'error' as const,
      type: 'outcome_unknown' as const,
      message: 'Recovered before host promotion.',
    };

    const foreignUser = await createUser(
      fx.harness.db,
      `foreign-${randomUUID()}`,
    );

    try {
      const denied = await fx.harness.tenantDb.runAs(foreignUser, (tx) =>
        new NativeFilesRepository(tx).recoverHostPromotion({
          runId: seeded.runId,
          userId: foreignUser,
          attemptId: run.activeAttemptId!,
          toolCallId: 'command',
          result: recoveredResult,
        }),
      );

      expect(denied).toEqual({
        disposition: 'fenced',
        result: recoveredResult,
      });
    } finally {
      await fx.harness.db.execute(
        sql`DELETE FROM users WHERE id = ${foreignUser}`,
      );
    }

    const recovered = await fx.db((tx) =>
      new NativeFilesRepository(tx).recoverHostPromotion({
        runId: seeded.runId,
        userId: fx.userId,
        attemptId: run.activeAttemptId!,
        toolCallId: 'command',
        result: recoveredResult,
      }),
    );

    expect(recovered).toEqual({
      disposition: 'recovery_won',
      result: recoveredResult,
    });

    const lockReady = Promise.withResolvers<void>();

    const releaseLock = Promise.withResolvers<void>();

    const runLock = fx.db(async (tx) => {
      const locked = await new RunRowFenceRepository(tx).lockHostPromotion(
        seeded.runId,
        fx.userId,
        run.activeAttemptId!,
      );

      if (locked === undefined)
        throw new Error('Could not lock the active Run.');

      lockReady.resolve();
      await releaseLock.promise;
    });

    try {
      await lockReady.promise;
      await fx.storeItems(seeded.chatId, ['continue'], 'steer', seeded.runId);
      // Recovery owns the receipt; the Run-row lock delays the real promotion.
      await new Promise((resolve) => setTimeout(resolve, 900));
      expect(
        (await fx.events(seeded.runId)).filter(
          (event) => event.eventType === 'native.result',
        ),
      ).toHaveLength(1);
      expect(
        (await fx.events(seeded.runId)).some(
          (event) => event.eventType === 'tool.completed',
        ),
      ).toBe(false);
      expect(
        await fx.db((tx) =>
          new ChatJobsRepository(tx).listByChat(seeded.chatId, fx.userId),
        ),
      ).toHaveLength(0);
    } finally {
      releaseLock.resolve();
      await runLock;
    }

    const completion = await waitFor(
      async () =>
        (await fx.events(seeded.runId)).find(
          (event) => event.eventType === 'tool.completed',
        ),
      10_000,
      'the promotion to reconcile the committed recovery receipt',
    );

    expect(completion.payload).toMatchObject({
      toolCallId: 'command',
      output: recoveredResult,
    });

    expect(
      (await fx.events(seeded.runId)).filter(
        (event) => event.eventType === 'native.result',
      ),
    ).toHaveLength(1);
    expect(
      await fx.db((tx) =>
        new ChatJobsRepository(tx).listByChat(seeded.chatId, fx.userId),
      ),
    ).toHaveLength(0);

    await fx.terminal(seeded.runId);

    const ownerRun = await fx.db((tx) =>
      new RunsRepository(tx).findById(seeded.runId, fx.userId),
    );

    expect(ownerRun?.status).toBe('completed');

    expect(ownerRun?.completedAttemptId).toBeDefined();

    expect(ownerRun?.completedAttemptId).not.toBe(run.activeAttemptId);
    expect(await fx.types(seeded.runId)).toContain('run.delivered');
  });
});
