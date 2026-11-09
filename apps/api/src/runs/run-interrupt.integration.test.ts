/**
 * run-steering, `interrupt` layer — an owner interrupt against real Postgres
 * (RLS active) and the co-located worker, with the scripted model client. No
 * HTTP admits an `interrupt` yet: the items are stored directly in
 * `chat_deliveries`, and the run-control NOTIFY is sent in the same
 * transaction, as admission will.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import { z } from 'zod';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { MessagesRepository } from '../chats/chats-repository';
import { type ChatDeliveryMode, type Message } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  registerTestOnlyTool,
  unregisterTestOnlyTool,
} from '../tools/registry';
import { waitFor } from '../testing/support';
import { NativeFilesRepository } from './native-files-repository';
import { notifyRunControl } from './run-control';
import { isTerminalRunStatus } from './run-status';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { type ScriptedStep } from './scripted-model-step';
import {
  bootWorkerHarness,
  createUser,
  dispatchRun,
  seedRun,
  type WorkerHarness,
} from './worker-harness';

const describeIfDb = process.env['TEST_DATABASE_URL']
  ? describe
  : describe.skip;

vi.setConfig({ testTimeout: 90_000 });

const answer = (text: string): ScriptedStep => [
  { type: 'text', id: 't', text },
];
const call = (
  toolCallId: string,
  toolName: string,
  input: UnknownRecord,
): ScriptedStep => [{ type: 'tool-call', toolCallId, toolName, input }];

/** A promise the test settles from outside. */
function deferred<T = void>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** `role:text` or `role:<part type>` per provider message part. */
function flatten(
  prompt: ReadonlyArray<{
    role: string;
    content: string | ReadonlyArray<{ type: string; text?: string }>;
  }>,
): Array<string> {
  return prompt.flatMap(({ role, content }) =>
    isString(content)
      ? [`${role}:${content}`]
      : content.map((part) =>
          part.type === 'text'
            ? `${role}:${part.text}`
            : `${role}:${part.type}`,
        ),
  );
}

const SIGNED = { openai: { itemId: 'rs_1', reasoningEncryptedContent: 'ENC' } };

type Seeded = Awaited<ReturnType<typeof seedRun>> & { modelId: string };

/** The part type and the first part's producer, for a stored message. */
function partKinds(message: Message): Array<string> {
  return message.parts.map((part) =>
    isRecord(part) &&
    isRecord(part['data']) &&
    isString(part['data']['producer'])
      ? `data-context:${part['data']['producer']}`
      : isRecord(part) && isString(part['type'])
        ? part['type']
        : 'unknown',
  );
}

describeIfDb('run steering interrupts', () => {
  let harness: WorkerHarness;
  let userId: string;
  let directory: string;

  /** A read-only tool that ignores its abort signal, so a result can arrive late. */
  const lookupGate = { current: deferred() };

  beforeAll(async () => {
    registerTestOnlyTool({
      id: 'slow_lookup',
      description: 'A read-only lookup that does not watch its abort signal.',
      classification: 'read_only',
      inputSchema: z.strictObject({}),
      execute: async () => {
        await lookupGate.current.promise;
        return { status: 'success', value: 'the late value' };
      },
    });
    harness = await bootWorkerHarness({
      allowedTools: ['read', 'bash', 'write', 'slow_lookup'],
      nativeExecutorId: 'run-interrupt-host',
    });
    userId = await createUser(harness.db, 'run-interrupt');
    directory = await mkdtemp(join(tmpdir(), 'run-interrupt-'));
  });

  afterAll(async () => {
    await harness.close();
    unregisterTestOnlyTool('slow_lookup');
    await rm(directory, { recursive: true, force: true });
  });

  const db = <T>(work: (tx: Db) => Promise<T>) =>
    harness.tenantDb.runAs(userId, work);

  /** A pending item, with the control signal in the same transaction when asked. */
  async function store(
    seeded: Seeded,
    mode: ChatDeliveryMode,
    text: string,
    notify = false,
  ): Promise<string> {
    const id = randomUUID();
    await db(async (tx) => {
      await new ChatDeliveriesRepository(tx).insertPending({
        id,
        chatId: seeded.chatId,
        ownerUserId: userId,
        mode,
        parts: [{ type: 'text', text }],
        settings: { modelId: 'ignored', permissionMode: 'default' },
      });
      if (notify)
        await notifyRunControl(tx, { runId: seeded.runId, kind: 'interrupt' });
    });
    return id;
  }

  const interrupt = (seeded: Seeded, text: string) =>
    store(seeded, 'interrupt', text, true);

  const events = (runId: string) =>
    db((tx) => new RunEventsRepository(tx).listByRunId(runId, userId));

  const types = async (runId: string) =>
    (await events(runId)).map((event) => event.eventType);

  const terminal = (runId: string) =>
    waitFor(
      async () => {
        const found = await db((tx) =>
          new RunsRepository(tx).findById(runId, userId),
        );
        return found && isTerminalRunStatus(found.status) ? found : undefined;
      },
      40_000,
      `Run ${runId} to settle`,
    );

  const messages = (chatId: string) =>
    db((tx) => new MessagesRepository(tx).findByChatId(chatId, userId));

  const textOf = (message: Message) =>
    message.parts
      .flatMap((part) =>
        isRecord(part) && part['type'] === 'text' && isString(part['text'])
          ? [part['text']]
          : [],
      )
      .join('|');

  async function seed(text = 'first message'): Promise<Seeded> {
    const modelId = `run-interrupt-${randomUUID()}`;
    const seeded = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId,
      text,
    });
    return { ...seeded, modelId };
  }

  async function launch(
    seeded: Seeded,
    steps: ReadonlyArray<ScriptedStep>,
    beforeStep?: (index: number) => Promise<void> | void,
  ) {
    harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps,
      ...(beforeStep !== undefined && { beforeStep }),
    });
    const promptsBefore = harness.models.prompts.length;
    await dispatchRun({ queue: harness.queue, ...seeded, userId });
    return {
      prompts: () =>
        harness.models.prompts
          .slice(promptsBefore)
          .map((prompt) => flatten(prompt)),
    };
  }

  /** Holds the Run row lock until released, as a slow writer would. */
  async function holdRunLock(runId: string) {
    const locked = deferred();
    const release = deferred();
    const finished = db(async (tx) => {
      await tx.execute(sql`select id from runs where id = ${runId} for update`);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    return {
      release: async () => {
        release.resolve();
        await finished;
      },
    };
  }

  /** Waits until a worker statement is blocked on a lock. */
  const lockWaiterAppears = () =>
    waitFor(
      async () => {
        const rows = await harness.db.execute(
          sql`select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock'`,
        );
        return Number(rows[0]?.['waiting']) > 0 ? true : undefined;
      },
      20_000,
      'a statement to wait on the Run lock',
    );

  describe('a model response', () => {
    it('An interrupt during a model response', async () => {
      const held = deferred();
      const seeded = await seed();
      const started = await launch(seeded, [
        [
          {
            type: 'reasoning',
            id: 'r1',
            text: 'first thought',
            providerMetadata: SIGNED,
          },
          { type: 'text', id: 't1', text: 'I will start by ' },
          {
            type: 'reasoning',
            id: 'r2',
            text: 'a thought the stop cuts',
            open: true,
          },
          { type: 'hold', onHeld: held.resolve },
        ],
        answer('redirected'),
      ]);
      await held.promise;

      await interrupt(seeded, 'change course');
      const finished = await terminal(seeded.runId);

      // The Run never became terminal at the stop: it went on to answer.
      expect(finished.status).toBe('completed');
      const log = await events(seeded.runId);
      const delivered = log.find(
        (event) => event.eventType === 'run.delivered',
      );
      expect(delivered?.payload).toMatchObject({
        cause: 'interrupt',
        stoppedCalls: [],
      });
      expect(
        log.filter((event) => event.eventType === 'run.started'),
      ).toHaveLength(1);
      expect(
        log.findIndex((event) => event.eventType === 'model.completed'),
      ).toBeLessThan(
        log.findIndex((event) => event.eventType === 'run.delivered'),
      );

      const [first, reply, delivery, second] = await messages(seeded.chatId);
      expect(reply?.usage).toMatchObject({
        status: 'aborted',
        complete: false,
        interrupted: true,
      });
      expect(textOf(reply)).toBe('I will start by ');
      // An interrupted reply keeps its cut reasoning part, marked.
      expect(reply.parts).toMatchObject([
        { type: 'reasoning', text: 'first thought', providerMetadata: SIGNED },
        { type: 'text', text: 'I will start by ' },
        {
          type: 'reasoning',
          text: 'a thought the stop cuts',
          providerMetadata: { llame: { interrupted: true } },
        },
      ]);
      // The delivered message opens with the notice, then the owner text.
      expect(partKinds(delivery)).toEqual(['data-context:interrupted', 'text']);
      expect(textOf(delivery)).toBe('change course');
      expect(delivery?.id).toBe(finished.messageId);
      expect(textOf(second)).toBe('redirected');
      expect(first?.role).toBe('user');

      // The next request of the same Run carries the interrupt, and the cut part
      // does not replay: only the first, signed reasoning part does.
      const request = started.prompts()[1] ?? [];
      expect(request.at(-1)).toBe('user:change course');
      expect(
        request.some((line) =>
          line.includes('The owner interrupted your previous step'),
        ),
      ).toBe(true);
      expect(request).toContain('assistant:I will start by ');
      expect(
        request.filter((line) => line === 'assistant:reasoning'),
      ).toHaveLength(1);
    });

    it('An interrupt takes the pending steers along', async () => {
      const held = deferred();
      const seeded = await seed();
      await launch(seeded, [
        [
          { type: 'text', id: 't1', text: 'working' },
          { type: 'hold', onHeld: held.resolve },
        ],
        answer('both seen'),
      ]);
      await held.promise;

      await store(seeded, 'steer', 'a steer');
      await interrupt(seeded, 'an interrupt');
      await terminal(seeded.runId);

      const delivered = (await messages(seeded.chatId)).filter(
        (message) =>
          message.role === 'user' && textOf(message) === 'a steer|an interrupt',
      );
      // One delivered message holds both, in order, behind one notice.
      expect(delivered).toHaveLength(1);
      expect(partKinds(delivered[0])).toEqual([
        'data-context:interrupted',
        'text',
        'text',
      ]);
      expect(await types(seeded.runId)).toContain('run.delivered');
    });
  });

  describe('a tool call', () => {
    it('An interrupt kills a long command', async () => {
      const pidFile = join(directory, `pid-${randomUUID()}`);
      const seeded = await seed();
      const started = await launch(seeded, [
        call('slow', 'bash', {
          command: `echo $$ > ${pidFile}; exec sleep 60`,
          cwd: directory,
        }),
        answer('after the kill'),
      ]);
      await waitFor(
        async () =>
          (await types(seeded.runId)).includes('tool.started')
            ? true
            : undefined,
        20_000,
        'the bash call to start',
      );
      await waitFor(
        () =>
          readFile(pidFile, 'utf8').then(
            (text) => text.trim() || undefined,
            () => undefined,
          ),
        10_000,
        'the command to record its pid',
      );
      const begun = Date.now();

      await interrupt(seeded, 'stop that');
      const finished = await terminal(seeded.runId);

      expect(Date.now() - begun).toBeLessThan(30_000);
      expect(finished.status).toBe('completed');
      const pid = Number((await readFile(pidFile, 'utf8')).trim());
      expect(() => process.kill(pid, 0)).toThrow('ESRCH');

      // The call settled once, marked, and the notice names it.
      const completed = (await events(seeded.runId)).filter(
        (event) => event.eventType === 'tool.completed',
      );
      expect(completed).toHaveLength(1);
      expect(completed[0]?.payload).toMatchObject({
        toolCallId: 'slow',
        interrupted: true,
      });
      const [, firstReply, delivery] = await messages(seeded.chatId);
      expect(firstReply?.parts).toMatchObject([
        {
          type: 'tool-bash',
          toolCallId: 'slow',
          resultProviderMetadata: { llame: { interrupted: true } },
        },
      ]);
      expect(
        (await events(seeded.runId)).find(
          (event) => event.eventType === 'run.delivered',
        )?.payload,
      ).toMatchObject({
        stoppedCalls: [{ toolName: 'bash', toolCallId: 'slow' }],
      });
      const notice = JSON.stringify(delivery?.parts);
      expect(notice).toContain('`bash`, call id \\"slow\\"');
      expect(notice).toContain('Their effects are unknown');
      // The Run carried on with the interrupt.
      expect((started.prompts()[1] ?? []).at(-1)).toBe('user:stop that');
    });

    it('A late tool result does not replace the settlement', async () => {
      lookupGate.current = deferred();
      const seeded = await seed();
      await launch(seeded, [
        call('lookup', 'slow_lookup', {}),
        answer('moved on'),
      ]);
      await waitFor(
        async () =>
          (await types(seeded.runId)).includes('tool.started')
            ? true
            : undefined,
        20_000,
        'the lookup to start',
      );

      await interrupt(seeded, 'never mind');
      await waitFor(
        async () =>
          (await types(seeded.runId)).includes('run.delivered')
            ? true
            : undefined,
        20_000,
        'the interrupt to be delivered',
      );
      // The call ignored its signal and now returns a result.
      lookupGate.current.resolve();
      await terminal(seeded.runId);

      const completed = (await events(seeded.runId)).filter(
        (event) => event.eventType === 'tool.completed',
      );
      expect(completed).toHaveLength(1);
      expect(completed[0]?.payload).toMatchObject({
        toolCallId: 'lookup',
        status: 'error',
        interrupted: true,
        output: {
          type: 'cancelled',
          message:
            'The owner interrupted this call before it finished. It made no change.',
        },
      });
      // The first settlement stands in history, and a read-only call is no
      // stopped call: its effects are known.
      const [, firstReply] = await messages(seeded.chatId);
      expect(firstReply?.parts).toMatchObject([
        { toolCallId: 'lookup', state: 'output-error', outcome: 'cancelled' },
      ]);
      expect(
        (await events(seeded.runId)).find(
          (event) => event.eventType === 'run.delivered',
        )?.payload,
      ).toMatchObject({ stoppedCalls: [] });
    });

    it('A write finishes before the interrupt applies', async () => {
      const target = join(directory, `written-${randomUUID()}.txt`);
      const lock = deferred<Awaited<ReturnType<typeof holdRunLock>>>();
      const seeded = await seed();
      await launch(
        seeded,
        [
          call('w', 'write', { path: target, content: 'whole file' }),
          answer('done'),
        ],
        async (index) => {
          // The first step's tool call waits behind the Run row lock, so the
          // write is in flight when the interrupt arrives.
          if (index === 0) lock.resolve(await holdRunLock(seeded.runId));
        },
      );
      const held = await lock.promise;
      await lockWaiterAppears();

      await interrupt(seeded, 'stop writing');
      await held.release();
      const finished = await terminal(seeded.runId);

      expect(finished.status).toBe('completed');
      expect(await readFile(target, 'utf8')).toBe('whole file');
      const log = await events(seeded.runId);
      const completed = log.findIndex(
        (event) => event.eventType === 'tool.completed',
      );
      const delivered = log.findIndex(
        (event) => event.eventType === 'run.delivered',
      );
      // The write's own result is stored, unmarked, before the delivery.
      expect(log[completed]?.payload).toMatchObject({
        toolCallId: 'w',
        status: 'success',
      });
      expect(log[completed]?.payload).not.toHaveProperty('interrupted');
      expect(delivered).toBeGreaterThan(completed);
    });
  });

  describe('when no work is in progress', () => {
    it('An interrupt during compaction acts as a steer', async () => {
      // The Run has not begun its first request: no segment is in flight, so
      // the control signal finds nothing to stop.
      const seeded = await seed();
      await interrupt(seeded, 'redirect');
      const started = await launch(seeded, [
        call('r1', 'read', { path: directory }),
        answer('after the redirect'),
      ]);
      const finished = await terminal(seeded.runId);

      expect(finished.status).toBe('completed');
      const log = await events(seeded.runId);
      const completed = log.findIndex(
        (event) => event.eventType === 'tool.completed',
      );
      const delivered = log.findIndex(
        (event) => event.eventType === 'run.delivered',
      );
      // The first step ran to its end; the item was delivered after it.
      expect(log[completed]?.payload).toMatchObject({
        toolCallId: 'r1',
        status: 'success',
      });
      expect(log[completed]?.payload).not.toHaveProperty('interrupted');
      expect(delivered).toBeGreaterThan(completed);
      expect((started.prompts()[1] ?? []).at(-1)).toBe('user:redirect');
    });
  });

  describe('a stale attempt', () => {
    it('a tool admission after the interrupt delivery writes no attempt', async () => {
      const held = deferred();
      const seeded = await seed();
      await launch(seeded, [
        [
          { type: 'text', id: 't1', text: 'working' },
          { type: 'hold', onHeld: held.resolve },
        ],
        answer('done'),
      ]);
      await held.promise;
      await interrupt(seeded, 'redirect');
      await terminal(seeded.runId);

      const log = await events(seeded.runId);
      const interruptedAttempt = log.find(
        (event) => event.eventType === 'model.requested',
      )?.payload;
      const first = isRecord(interruptedAttempt)
        ? interruptedAttempt['attemptId']
        : undefined;
      const run = await db((tx) =>
        new RunsRepository(tx).findById(seeded.runId, userId),
      );
      const deliverySequence = log.findLast(
        (event) => event.eventType === 'run.started',
      )?.sequence;
      if (!isString(first) || deliverySequence === undefined) {
        throw new Error('the Run recorded no first attempt');
      }
      expect(run?.activeAttemptId).not.toBe(first);

      const admit = (attemptId: string, toolCallId: string) =>
        db((tx) =>
          new NativeFilesRepository(tx).begin({
            runId: seeded.runId,
            userId,
            fence: { bound: false },
            deliverySequence,
            attemptId,
            toolCallId,
            operation: 'write',
            path: '/tmp/late',
          }),
        );
      const attempts = async () =>
        (await events(seeded.runId)).filter(
          (event) => event.eventType === 'native.attempt',
        );

      // A call of the interrupted segment that reaches admission after the
      // delivery is refused and records nothing.
      expect(await admit(first, 'late')).toMatchObject({
        status: 'error',
        type: 'executor_unavailable',
      });
      expect(await attempts()).toHaveLength(0);
      // The delivered segment's own attempt is admitted.
      expect(
        await admit(run?.activeAttemptId ?? '', 'current'),
      ).toBeUndefined();
      expect(await attempts()).toHaveLength(1);
    });
  });
});

describeIfDb('an interrupt across processes', () => {
  let worker: WorkerHarness;
  let api: WorkerHarness;
  let userId: string;

  beforeAll(async () => {
    worker = await bootWorkerHarness();
    // The API side consumes no `runs`: it holds no listener and no registry entry.
    api = await bootWorkerHarness({ runsConcurrency: null });
    userId = await createUser(worker.db, 'run-interrupt-dedicated');
  });

  afterAll(async () => {
    await api.close();
    await worker.close();
  });

  it('An interrupt reaches a dedicated worker', async () => {
    const held = deferred();
    const modelId = `run-interrupt-${randomUUID()}`;
    const seeded = await seedRun({
      tenantDb: worker.tenantDb,
      userId,
      modelId,
    });
    worker.models.register(modelId, {
      kind: 'step-script',
      steps: [
        [
          { type: 'text', id: 't1', text: 'streaming' },
          { type: 'hold', onHeld: held.resolve },
        ],
        answer('after the interrupt'),
      ],
    });
    await dispatchRun({ queue: worker.queue, ...seeded, userId, modelId });
    await held.promise;

    // The owner's request lands in the API process: the item and the signal.
    await api.tenantDb.runAs(userId, async (tx) => {
      await new ChatDeliveriesRepository(tx).insertPending({
        id: randomUUID(),
        chatId: seeded.chatId,
        ownerUserId: userId,
        mode: 'interrupt',
        parts: [{ type: 'text', text: 'from the API process' }],
        settings: { modelId: 'ignored', permissionMode: 'default' },
      });
      await notifyRunControl(tx, { runId: seeded.runId, kind: 'interrupt' });
    });

    // The response stops without a wait for a step boundary: the held stream
    // never reaches one, so only the signal can end it.
    const finished = await waitFor(
      async () => {
        const found = await worker.tenantDb.runAs(userId, (tx) =>
          new RunsRepository(tx).findById(seeded.runId, userId),
        );
        return found && isTerminalRunStatus(found.status) ? found : undefined;
      },
      40_000,
      'the Run to settle',
    );
    expect(finished.status).toBe('completed');
    const log = await worker.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(seeded.runId, userId),
    );
    expect(
      log.find((event) => event.eventType === 'run.delivered')?.payload,
    ).toMatchObject({ cause: 'interrupt' });
  });
});
