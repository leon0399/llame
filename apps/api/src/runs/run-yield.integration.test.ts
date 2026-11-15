import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { RunAbortRegistry } from './run-abort-registry';
import { BashJobRegistry } from '../jobs/bash-job-registry';
import { nativeReadTool } from '../tools/native-files';
import { nativeGrepTool } from '../tools/grep';
import { type Tool } from '../tools/types';
import { waitFor } from '../testing/support';
import {
  answer,
  call,
  useSegmentsFixture,
} from '../testing/run-segments.test-fixture';

if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    'run-yield.integration.test.ts requires the integration database',
  );

vi.setConfig({ testTimeout: 60_000 });

describe('Run segment yield', () => {
  const fx = useSegmentsFixture('run-yield', {
    allowedTools: ['bash', 'read', 'grep'],
    nativeExecutorId: 'run-yield-host',
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])(
    'returns host bash on steer, including a steer pending before the segment (%s)',
    async (pending) => {
      const seeded = await fx.seed();
      const pidFile = join(fx.directory, `pid-${randomUUID()}`);

      if (pending) await fx.storeItems(seeded.chatId, ['new direction']);

      const started = await fx.launch(seeded, [
        call('command', 'bash', {
          command: `echo $$ > ${pidFile}; exec sleep 30`,
          cwd: fx.directory,
        }),
        answer('after steer'),
      ]);

      if (!pending) {
        await waitFor(
          () => readFile(pidFile, 'utf8').catch(() => undefined),
          10_000,
          'the foreground command to start',
        );
        await fx.storeItems(
          seeded.chatId,
          ['new direction'],
          'steer',
          seeded.runId,
        );
      }

      expect((await fx.terminal(seeded.runId)).status).toBe('completed');
      const log = await fx.events(seeded.runId);

      const completed = log.findIndex(
        (event) => event.eventType === 'tool.completed',
      );

      const delivered = log.findIndex(
        (event) => event.eventType === 'run.delivered',
      );

      expect(log[completed]?.payload).toMatchObject({
        toolCallId: 'command',
        status: 'success',
        output: { backgrounded: true, cause: 'message' },
      });
      expect(log[completed]?.payload).not.toHaveProperty('interrupted');
      expect(delivered).toBeGreaterThan(completed);
      expect(log[delivered]?.payload).toMatchObject({ cause: 'steer' });
      const pid = Number((await readFile(pidFile, 'utf8')).trim());
      expect(process.kill(pid, 0)).toBe(true);
      expect(started.prompts()[1]?.at(-1)).toBe('user:new direction');
    },
  );

  it('delivers the steer only after a promotion receipt exceeds its 750 ms window', async () => {
    const registry = fx.harness.moduleRef.get(BashJobRegistry, {
      strict: false,
    });

    const promotionStarted = Promise.withResolvers<void>();
    const allowPromotion = Promise.withResolvers<void>();

    const promotion = vi
      .spyOn(registry, 'promoteWithReceipt')
      .mockImplementation(async (...args) => {
        promotionStarted.resolve();
        await allowPromotion.promise;

        promotion.mockRestore();

        return registry.promoteWithReceipt(...args);
      });

    const pidFile = join(fx.directory, `pid-${randomUUID()}`);
    const seeded = await fx.seed();

    const started = await fx.launch(seeded, [
      call('command', 'bash', {
        command: `echo $$ > ${pidFile}; exec sleep 30`,
        cwd: fx.directory,
      }),
      answer('after delayed move'),
    ]);

    await waitFor(
      () => readFile(pidFile, 'utf8').catch(() => undefined),
      10_000,
      'the command to start',
    );
    await fx.storeItems(
      seeded.chatId,
      ['new direction'],
      'steer',
      seeded.runId,
    );

    try {
      await promotionStarted.promise;
      // This must cross the worker's real 750 ms window; fake timers would not
      // advance the integration worker's promotion transaction.
      await new Promise((resolve) => setTimeout(resolve, 800));

      expect(
        (await fx.events(seeded.runId)).some(
          (event) => event.eventType === 'tool.completed',
        ),
      ).toBe(false);
      expect(
        (await fx.events(seeded.runId)).some(
          (event) => event.eventType === 'run.delivered',
        ),
      ).toBe(false);
    } finally {
      allowPromotion.resolve();
    }

    const completed = await waitFor(
      async () => {
        const log = await fx.events(seeded.runId);

        return log.find((event) => event.eventType === 'tool.completed');
      },
      5000,
      'the promotion receipt',
    );

    expect(completed.payload).toMatchObject({
      output: { status: 'success' },
    });
    expect((await fx.terminal(seeded.runId)).status).toBe('completed');
    const log = await fx.events(seeded.runId);
    const delivered = log.find((event) => event.eventType === 'run.delivered');

    expect(delivered?.payload).toMatchObject({ cause: 'steer' });
    expect(started.prompts()[1]?.at(-1)).toBe('user:new direction');
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    expect(process.kill(pid, 0)).toBe(true);
  });

  it.each(['read', 'grep'] as const)(
    'a steer waits for the %s result without aborting it',
    async (name) => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const tool: Tool = name === 'read' ? nativeReadTool : nativeGrepTool;
      const original = { ...tool };
      let signal: AbortSignal | undefined;
      vi.spyOn(tool, 'execute').mockImplementation(async (context, args) => {
        signal = context.abortSignal;
        entered.resolve();
        await release.promise;

        return original.execute(context, args);
      });
      const seeded = await fx.seed();
      await fx.launch(seeded, [
        call(
          'lookup',
          name,
          name === 'read'
            ? { path: fx.directory }
            : { patterns: ['Run'], scopes: [fx.directory] },
        ),
        answer('after lookup'),
      ]);
      await entered.promise;

      const aborts = fx.harness.moduleRef.get(RunAbortRegistry, {
        strict: false,
      });

      const segment = aborts.segmentOf(seeded.runId);
      expect(segment).toBeDefined();

      try {
        await fx.storeItems(
          seeded.chatId,
          ['new direction'],
          'steer',
          seeded.runId,
        );
        await vi.waitFor(() =>
          expect(segment?.control.yield.signal.aborted).toBe(true),
        );
        expect(signal?.aborted).toBe(false);
        const before = await fx.events(seeded.runId);
        expect(
          before.some((event) => event.eventType === 'run.delivered'),
        ).toBe(false);
        expect(
          before.some((event) => event.eventType === 'tool.completed'),
        ).toBe(false);
      } finally {
        release.resolve();
      }

      expect((await fx.terminal(seeded.runId)).status).toBe('completed');
      const log = await fx.events(seeded.runId);

      const completed = log.findIndex(
        (event) => event.eventType === 'tool.completed',
      );

      const delivered = log.findIndex(
        (event) => event.eventType === 'run.delivered',
      );

      expect(log[completed]?.payload).toMatchObject({
        toolCallId: 'lookup',
        status: 'success',
      });
      expect(delivered).toBeGreaterThan(completed);
      expect(log[delivered]?.payload).toMatchObject({ cause: 'steer' });
    },
  );
});
