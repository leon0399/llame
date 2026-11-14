/**
 * run-steering, `interrupt` layer — an owner interrupt against real Postgres
 * (RLS active) and the co-located worker, with the scripted model client. The
 * items are stored directly in `chat_deliveries`, with the run-control NOTIFY
 * in the same transaction, as admission sends it (the HTTP admission has its
 * own suite).
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { isRecord, isString } from '@workspace/runtime-safety';
import { z } from 'zod';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { CompactionService } from '../compaction/compaction.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { McpRuntimeService } from '../mcp/mcp-runtime.service';
import { type ChatDelivery, type Message } from '../db/schema';
import { composeAttemptToolCatalog } from './effective-context-resolver';
import {
  registerTestOnlyTool,
  unregisterTestOnlyTool,
} from '../tools/registry';
import { waitFor } from '../testing/support';
import { type Tool } from '../tools/types';
import {
  hashToolDeclaration,
  type TurnToolCandidate,
} from '../tools/turn-tool-catalog';
import { NativeFilesRepository } from './native-files-repository';
import { notifyRunControl } from './run-control';
import {
  answer,
  call,
  useSegmentsFixture,
  type SeededRun,
} from '../testing/run-segments.test-fixture';
import { isTerminalRunStatus } from './run-status';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import {
  bootWorkerHarness,
  createUser,
  dispatchRun,
  seedRun,
  type WorkerHarness,
} from './worker-harness';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'run-interrupt.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration` or provide an already-provisioned database.',
  );
}

vi.setConfig({ testTimeout: 90_000 });

/** A held Run row lock, released by the test. */
type RunLockHold = { release: () => Promise<void> };

const SIGNED = { openai: { itemId: 'rs_1', reasoningEncryptedContent: 'ENC' } };

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

const textOf = (message: Message) =>
  message.parts
    .flatMap((part) =>
      isRecord(part) && part['type'] === 'text' && isString(part['text'])
        ? [part['text']]
        : [],
    )
    .join('|');

/** A read-only tool that ignores its abort signal, so a result can arrive late. */
const lookupGate = { current: Promise.withResolvers<void>() };
const lookupReturned = { current: Promise.withResolvers<void>() };

/** An MCP-named tool that records its `native.attempt` like the runtime does, then hangs. */
const mcpSent = { current: Promise.withResolvers<void>() };

const MCP_TOOL_ID = 'mcp__fixture__send';

const mcpTool: Tool = {
  id: MCP_TOOL_ID,
  description: 'An MCP-named call whose request is sent and never answered.',
  classification: 'unverified',
  inputSchema: z.strictObject({}),
  execute: async (context) => {
    const { runId } = context;

    if (runId === undefined) throw new Error('The call has no Run.');
    await context.tenantDb.runAs(context.userId, (tx) =>
      new NativeFilesRepository(tx).begin({
        runId,
        userId: context.userId,
        fence: { bound: false },
        deliverySequence: context.nativeDeliverySequence,
        attemptId: context.attemptId,
        toolCallId: context.toolCallId ?? 'mcp',
        operation: 'mcp',
        path: MCP_TOOL_ID,
      }),
    );
    context.onMcpDispatchRecorded?.();
    mcpSent.current.resolve();

    return new Promise(() => {});
  },
};

/** Makes the runtime offer `mcpTool` as an operator MCP tool, as a connected server would. */
async function offerMcpTool(runtime: McpRuntimeService) {
  const candidates: ReadonlyArray<TurnToolCandidate> = [
    {
      source: { type: 'mcp', serverId: 'fixture' },
      state: 'available',
      tool: mcpTool,
    },
  ];

  const { declarations } = await composeAttemptToolCatalog({
    allowedToolRules: [MCP_TOOL_ID],
    callTimeoutSeconds: BUILT_IN_DEFAULTS.tools.callTimeoutSeconds,
    candidates: [],
    dynamicCandidates: candidates,
  });

  const [declaration] = declarations;

  if (!declaration) throw new Error('The MCP fixture tool did not resolve.');
  vi.spyOn(runtime, 'snapshotCandidates').mockReturnValue(candidates);
  vi.spyOn(runtime, 'resolveDynamicTool').mockImplementation((id) =>
    id === MCP_TOOL_ID
      ? {
          state: 'available',
          declarationHash: hashToolDeclaration(declaration),
          executor: mcpTool,
        }
      : { state: 'not_dynamic' },
  );
}

describe('run steering interrupts', () => {
  beforeAll(() => {
    registerTestOnlyTool({
      id: 'slow_lookup',
      description: 'A read-only lookup that does not watch its abort signal.',
      classification: 'read_only',
      inputSchema: z.strictObject({}),
      execute: async () => {
        await lookupGate.current.promise;
        lookupReturned.current.resolve();

        return { status: 'success', value: 'the late value' };
      },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => {
    unregisterTestOnlyTool('slow_lookup');
  });

  const fx = useSegmentsFixture('run-interrupt', {
    allowedTools: [
      'read',
      'bash',
      'write',
      'slow_lookup',
      'mcp__fixture__send',
    ],
    nativeExecutorId: 'run-interrupt-host',
  });

  const { db, storeItems, events, types, terminal, messages, seed, launch } =
    fx;

  const interrupt = async (seeded: SeededRun, text: string) => {
    const [id] = await storeItems(
      seeded.chatId,
      [text],
      'interrupt',
      seeded.runId,
    );

    return id ?? '';
  };

  /**
   * Runs `hook` inside the next delivery transaction, after it locked the Run
   * and the Chat and before it reads the pending items: a window in which the
   * owner can withdraw an item. Register it before the item is stored.
   */
  function beforeNextDelivery(hook: () => Promise<void>) {
    // eslint-disable-next-line typescript/unbound-method -- re-invoked with the instance below.
    const original = ChatDeliveriesRepository.prototype.lockPendingSteering;
    vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'lockPendingSteering',
    ).mockImplementationOnce(async function (
      this: ChatDeliveriesRepository,
      chatId: string,
      ownerUserId: string,
    ): Promise<Array<ChatDelivery>> {
      await hook();

      // eslint-disable-next-line typescript/no-unsafe-assignment -- the spied method's own result, passed through.
      const items: Array<ChatDelivery> = await original.call(
        this,
        chatId,
        ownerUserId,
      );

      return items;
    });
  }

  /** An interrupt the owner withdraws inside the next delivery. */
  async function interruptWithdrawnAtDelivery(seeded: SeededRun) {
    let id = '';
    beforeNextDelivery(async () => {
      await db((tx) =>
        new ChatDeliveriesRepository(tx).withdrawPending(
          seeded.chatId,
          id,
          fx.userId,
        ),
      );
    });
    id = await interrupt(seeded, 'withdrawn');
  }

  const waitForType = (runId: string, type: string, what: string) =>
    waitFor(
      async () => ((await types(runId)).includes(type) ? true : undefined),
      20_000,
      what,
    );

  /** Waits until a long `bash` call has started and recorded its pid. */
  async function bashStarted(seeded: SeededRun, pidFile: string) {
    await waitForType(seeded.runId, 'tool.started', 'the bash call to start');
    await waitFor(
      () =>
        readFile(pidFile, 'utf8').then(
          (text) => text.trim() || undefined,
          () => undefined,
        ),
      10_000,
      'the command to record its pid',
    );
  }

  const slowBash = (pidFile: string) => ({
    command: `echo $$ > ${pidFile}; exec sleep 60`,
    cwd: fx.directory,
  });

  const deliveredEvent = async (runId: string) =>
    (await events(runId)).find((event) => event.eventType === 'run.delivered')
      ?.payload;

  /** Holds the Run row lock until released, as a slow writer would. */
  async function holdRunLock(runId: string): Promise<RunLockHold> {
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();

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

  /** Waits until a statement of this database is blocked on a lock. */
  const lockWaiterAppears = () =>
    waitFor(
      async () => {
        const rows = await fx.harness.db.execute(
          sql`select count(*)::int as waiting from pg_stat_activity
              where wait_event_type = 'Lock' and datname = current_database()`,
        );

        return Number(rows[0]?.['waiting']) > 0 ? true : undefined;
      },
      20_000,
      'a statement to wait on the Run lock',
    );

  describe('a model response', () => {
    it('An interrupt during a model response', async () => {
      const held = Promise.withResolvers<void>();
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
      expect(partKinds(delivery)).toEqual([
        'data-context:interrupted',
        'data-context:temporal',
        'text',
      ]);
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
      const held = Promise.withResolvers<void>();
      const seeded = await seed();
      await launch(seeded, [
        [
          { type: 'text', id: 't1', text: 'working' },
          { type: 'hold', onHeld: held.resolve },
        ],
        answer('both seen'),
      ]);
      await held.promise;

      await storeItems(seeded.chatId, ['a steer']);
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
        'data-context:temporal',
        'text',
        'text',
      ]);
      expect(await types(seeded.runId)).toContain('run.delivered');
    });

    it('An interrupt met at a plain step boundary closes the reply aborted, with the notice', async () => {
      // Stored without the control signal: nothing stops, and the step-end
      // check finds it.
      const seeded = await seed();
      await launch(
        seeded,
        [call('r1', 'read', { path: fx.directory }), answer('after')],
        async (index) => {
          if (index === 0) {
            await storeItems(seeded.chatId, ['at the boundary'], 'interrupt');
          }
        },
      );
      const finished = await terminal(seeded.runId);

      expect(finished.status).toBe('completed');
      expect(await deliveredEvent(seeded.runId)).toMatchObject({
        cause: 'interrupt',
        stoppedCalls: [],
      });
      const [, reply, delivered] = await messages(seeded.chatId);
      expect(reply?.usage).toMatchObject({
        status: 'aborted',
        complete: false,
        interrupted: true,
      });
      expect(partKinds(delivered)).toEqual([
        'data-context:interrupted',
        'data-context:temporal',
        'text',
      ]);
    });

    it('An interrupt met at the final answer closes the reply aborted, with the notice', async () => {
      const seeded = await seed();
      await launch(
        seeded,
        [answer('first answer'), answer('second answer')],
        async (index) => {
          if (index === 0) {
            await storeItems(seeded.chatId, ['after the answer'], 'interrupt');
          }
        },
      );
      await terminal(seeded.runId);

      expect(await deliveredEvent(seeded.runId)).toMatchObject({
        cause: 'interrupt',
      });
      const [, reply, delivered] = await messages(seeded.chatId);
      expect(reply?.usage).toMatchObject({
        status: 'aborted',
        interrupted: true,
      });
      expect(partKinds(delivered)[0]).toBe('data-context:interrupted');
    });

    it('A withdrawn interrupt after the stop continues the same reply without a notice', async () => {
      const held = Promise.withResolvers<void>();
      const seeded = await seed();

      const started = await launch(seeded, [
        [
          {
            type: 'reasoning',
            id: 'r1',
            text: 'first thought',
            providerMetadata: SIGNED,
          },
          { type: 'text', id: 't1', text: 'partial ' },
          { type: 'reasoning', id: 'r2', text: 'a cut thought', open: true },
          { type: 'hold', onHeld: held.resolve },
        ],
        answer('rest'),
      ]);

      await held.promise;

      // The owner withdraws the item after the stop, before the delivery.
      await interruptWithdrawnAtDelivery(seeded);
      const finished = await terminal(seeded.runId);

      expect(finished.status).toBe('completed');
      expect(await types(seeded.runId)).not.toContain('run.delivered');
      const all = await messages(seeded.chatId);
      expect(all.map(({ role }) => role)).toEqual(['user', 'assistant']);
      expect(all[1]?.usage).toMatchObject({ status: 'completed' });
      const request = started.prompts()[1] ?? [];
      expect(request).toContain('assistant:partial ');
      // The signed first part replays; the part the stop cut does not.
      expect(
        request.filter((line) => line === 'assistant:reasoning'),
      ).toHaveLength(1);
      expect(
        request.some((line) =>
          line.includes('The owner interrupted your previous step'),
        ),
      ).toBe(false);
    });
  });

  describe('a tool call', () => {
    it('A host command continues after an interrupt without an interrupt marker', async () => {
      const pidFile = join(fx.directory, `pid-${randomUUID()}`);
      const seeded = await seed();

      const started = await launch(seeded, [
        call('slow', 'bash', slowBash(pidFile)),
        answer('after the yield'),
      ]);

      await bashStarted(seeded, pidFile);
      const begun = Date.now();

      await interrupt(seeded, 'stop that');
      const finished = await terminal(seeded.runId);

      expect(Date.now() - begun).toBeLessThan(30_000);
      expect(finished.status).toBe('completed');
      const pid = Number((await readFile(pidFile, 'utf8')).trim());
      expect(process.kill(pid, 0)).toBe(true);

      // The call returned its durable job before the interrupt was delivered.
      const completed = (await events(seeded.runId)).filter(
        (event) => event.eventType === 'tool.completed',
      );

      expect(completed).toHaveLength(1);
      expect(completed[0]?.payload).toMatchObject({
        toolCallId: 'slow',
        output: { backgrounded: true, cause: 'message' },
      });
      expect(completed[0]?.payload).not.toHaveProperty('interrupted');
      const [, firstReply, delivered] = await messages(seeded.chatId);
      expect(firstReply?.parts).toMatchObject([
        {
          type: 'tool-bash',
          toolCallId: 'slow',
          output: { backgrounded: true, cause: 'message' },
        },
      ]);
      expect(await deliveredEvent(seeded.runId)).toMatchObject({
        stoppedCalls: [],
      });
      expect(JSON.stringify(delivered?.parts)).not.toContain(
        'Their effects are unknown',
      );
      // The Run carried on with the interrupt.
      expect((started.prompts()[1] ?? []).at(-1)).toBe('user:stop that');
    });

    it('An interrupt yields the host command and retains the completed read', async () => {
      const pidFile = join(fx.directory, `pid-${randomUUID()}`);
      const seeded = await seed();
      await launch(seeded, [
        [
          {
            type: 'tool-call',
            toolCallId: 'slow',
            toolName: 'bash',
            input: slowBash(pidFile),
          },
          {
            type: 'tool-call',
            toolCallId: 'r1',
            toolName: 'read',
            input: { path: fx.directory },
          },
        ],
        answer('moved on'),
      ]);
      await bashStarted(seeded, pidFile);
      await waitFor(
        async () =>
          (await events(seeded.runId)).some(
            (event) =>
              event.eventType === 'tool.completed' &&
              isRecord(event.payload) &&
              event.payload['toolCallId'] === 'r1',
          )
            ? true
            : undefined,
        20_000,
        'the read to finish',
      );

      await interrupt(seeded, 'enough');
      await terminal(seeded.runId);

      const completed = (await events(seeded.runId)).filter(
        (event) => event.eventType === 'tool.completed',
      );

      const byId = (id: string) =>
        completed.find(
          (event) =>
            isRecord(event.payload) && event.payload['toolCallId'] === id,
        )?.payload;

      expect(completed).toHaveLength(2);
      expect(byId('r1')).toMatchObject({ status: 'success' });
      expect(byId('r1')).not.toHaveProperty('interrupted');
      expect(byId('slow')).toMatchObject({
        output: { backgrounded: true, cause: 'message' },
      });
      expect(byId('slow')).not.toHaveProperty('interrupted');
      expect(await deliveredEvent(seeded.runId)).toMatchObject({
        stoppedCalls: [],
      });
    });

    it('A sent MCP call is stopped with a recorded native result', async () => {
      mcpSent.current = Promise.withResolvers<void>();
      await offerMcpTool(fx.harness.moduleRef.get(McpRuntimeService));
      const seeded = await seed();
      await launch(seeded, [
        call('send', 'mcp__fixture__send', {}),
        answer('moved on'),
      ]);
      await mcpSent.current.promise;

      await interrupt(seeded, 'stop sending');
      await terminal(seeded.runId);

      const log = await events(seeded.runId);

      const result = log.find(
        (event) =>
          event.eventType === 'native.result' &&
          isRecord(event.payload) &&
          event.payload['toolCallId'] === 'send',
      );

      expect(result?.payload).toMatchObject({
        result: { status: 'error', type: 'outcome_unknown' },
      });
      expect(
        log.find((event) => event.eventType === 'tool.completed')?.payload,
      ).toMatchObject({ toolCallId: 'send', interrupted: true });
      expect(await deliveredEvent(seeded.runId)).toMatchObject({
        stoppedCalls: [{ toolName: 'mcp__fixture__send', toolCallId: 'send' }],
      });
    });

    it('A late tool result does not replace the settlement', async () => {
      lookupGate.current = Promise.withResolvers<void>();
      lookupReturned.current = Promise.withResolvers<void>();
      const seeded = await seed();
      await launch(seeded, [
        call('lookup', 'slow_lookup', {}),
        answer('moved on'),
      ]);
      await waitForType(seeded.runId, 'tool.started', 'the lookup to start');

      await interrupt(seeded, 'never mind');
      await waitForType(
        seeded.runId,
        'run.delivered',
        'the interrupt to be delivered',
      );
      // The call ignored its signal and now returns its value: the tool did
      // return it, and the first settlement still stands.
      lookupGate.current.resolve();
      await lookupReturned.current.promise;
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
      // A read-only call is no stopped call: its effects are known.
      const [, firstReply] = await messages(seeded.chatId);
      expect(firstReply?.parts).toMatchObject([
        { toolCallId: 'lookup', state: 'output-error', outcome: 'cancelled' },
      ]);
      expect(await deliveredEvent(seeded.runId)).toMatchObject({
        stoppedCalls: [],
      });
    });

    it('A write finishes before the interrupt applies', async () => {
      const target = join(fx.directory, `written-${randomUUID()}.txt`);
      const lock = Promise.withResolvers<RunLockHold>();
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
      // The interrupt path ran: it cut the model call, which a step-end
      // delivery would record with the SDK's finish reason instead.
      expect(
        log.find((event) => event.eventType === 'model.completed')?.payload,
      ).toMatchObject({ finishReason: null });
    });

    it('A withdrawn interrupt with a steer pending still delivers as an interrupt', async () => {
      const pidFile = join(fx.directory, `pid-${randomUUID()}`);
      const seeded = await seed();
      await launch(seeded, [
        call('slow', 'bash', slowBash(pidFile)),
        answer('after'),
      ]);
      await bashStarted(seeded, pidFile);

      await storeItems(seeded.chatId, ['a steer']);
      await interruptWithdrawnAtDelivery(seeded);
      await terminal(seeded.runId);

      // The model call was cut, but its command now has a durable job and
      // is not listed among calls with unknown effects.
      expect(await deliveredEvent(seeded.runId)).toMatchObject({
        cause: 'interrupt',
        stoppedCalls: [],
      });
      const [, reply, delivered] = await messages(seeded.chatId);
      expect(reply?.usage).toMatchObject({
        status: 'aborted',
        complete: false,
      });
      expect(textOf(delivered)).toBe('a steer');
    });
  });

  describe('when no work is in progress', () => {
    it('An interrupt during compaction acts as a steer', async () => {
      // A first Run completes, so the second Run's compaction check has a
      // turn to absorb. The check is held while the interrupt arrives: the
      // Run is registered with no step in flight.
      const first = await seed();
      await launch(first, [answer('earlier answer')]);
      await terminal(first.runId);
      const modelId = `run-interrupt-${randomUUID()}`;

      const second = {
        ...(await seedRun({
          tenantDb: fx.harness.tenantDb,
          userId: fx.userId,
          modelId,
          chatId: first.chatId,
          text: 'second message',
        })),
        modelId,
      };

      fx.harness.models.register(modelId, {
        kind: 'step-script',
        compactionThresholdTokens: 1,
        steps: [
          call('r1', 'read', { path: fx.directory }),
          answer('after the redirect'),
        ],
      });
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      vi.spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'summarizeCheckpoint',
      ).mockImplementation(async (input) => {
        entered.resolve();
        await release.promise;

        return {
          uptoSeq: input.triggeringUserSeq - 1,
          summary: 'earlier turns',
          usage: {},
        };
      });
      await dispatchRun({
        queue: fx.harness.queue,
        ...second,
        userId: fx.userId,
      });
      await entered.promise;

      await interrupt(second, 'redirect');
      release.resolve();
      const finished = await terminal(second.runId);

      expect(finished.status).toBe('completed');
      const log = await events(second.runId);

      const completed = log.findIndex(
        (event) => event.eventType === 'tool.completed',
      );

      const delivered = log.findIndex(
        (event) => event.eventType === 'run.delivered',
      );

      // The compaction completed, the first step ran to its end, and the item
      // was delivered after it.
      expect(
        (await messages(second.chatId)).some(
          ({ role }) => role === 'checkpoint',
        ),
      ).toBe(true);
      expect(log[completed]?.payload).toMatchObject({
        toolCallId: 'r1',
        status: 'success',
      });
      expect(log[completed]?.payload).not.toHaveProperty('interrupted');
      expect(delivered).toBeGreaterThan(completed);
    });
  });

  describe('a stale attempt', () => {
    it('a tool admission after the interrupt delivery writes no attempt', async () => {
      const held = Promise.withResolvers<void>();
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
        new RunsRepository(tx).findById(seeded.runId, fx.userId),
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
            userId: fx.userId,
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

describe('an interrupt across processes', () => {
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
    const held = Promise.withResolvers<void>();
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

  it("An interrupt signal for one owner's Run ignores another owner's pending interrupt", async () => {
    const other = await createUser(worker.db, 'run-interrupt-other');
    const held = Promise.withResolvers<void>();
    const modelId = `run-interrupt-${randomUUID()}`;

    const seeded = await seedRun({
      tenantDb: worker.tenantDb,
      userId,
      modelId,
    });

    const foreign = await seedRun({
      tenantDb: worker.tenantDb,
      userId: other,
      modelId: 'unused',
    });

    worker.models.register(modelId, {
      kind: 'step-script',
      steps: [
        [
          { type: 'text', id: 't1', text: 'streaming' },
          { type: 'hold', onHeld: held.resolve },
        ],
        answer('after the owner interrupts'),
      ],
    });
    await dispatchRun({ queue: worker.queue, ...seeded, userId, modelId });
    await held.promise;

    // The other owner has a pending interrupt item; this owner has none.
    await worker.tenantDb.runAs(other, (tx) =>
      new ChatDeliveriesRepository(tx).insertPending({
        id: randomUUID(),
        chatId: foreign.chatId,
        ownerUserId: other,
        mode: 'interrupt',
        parts: [{ type: 'text', text: 'not yours' }],
        settings: { modelId: 'ignored', permissionMode: 'default' },
      }),
    );

    const check = vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'hasPendingInterrupt',
    );

    await worker.tenantDb.runAs(userId, (tx) =>
      notifyRunControl(tx, { runId: seeded.runId, kind: 'interrupt' }),
    );
    // The listener read this owner's scope and found nothing pending.
    await waitFor(
      () => (check.mock.results.length > 0 ? true : undefined),
      10_000,
      'the listener to check the pending interrupt',
    );
    expect(await check.mock.results[0]?.value).toBe(false);

    // The stream is still held, so the Run was not stopped: only a pending
    // item of this owner ends it.
    const events = () =>
      worker.tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seeded.runId, userId),
      );

    expect((await events()).map((event) => event.eventType)).not.toContain(
      'run.delivered',
    );
    await worker.tenantDb.runAs(userId, async (tx) => {
      await new ChatDeliveriesRepository(tx).insertPending({
        id: randomUUID(),
        chatId: seeded.chatId,
        ownerUserId: userId,
        mode: 'interrupt',
        parts: [{ type: 'text', text: 'mine' }],
        settings: { modelId: 'ignored', permissionMode: 'default' },
      });
      await notifyRunControl(tx, { runId: seeded.runId, kind: 'interrupt' });
    });
    await waitFor(
      async () =>
        (await events()).some((event) => event.eventType === 'run.delivered')
          ? true
          : undefined,
      40_000,
      'the owner interrupt to be delivered',
    );
    check.mockRestore();
  });
});
