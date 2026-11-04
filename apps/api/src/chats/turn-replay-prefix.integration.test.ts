/**
 * Prefix equality (design D14): the first request of a turn starts with what
 * the previous turn's last request sent, then the response to that request.
 *
 * The whole-step scripted model client drives the real AI SDK and the
 * production seams, so the recorded prompt of each provider request is the
 * exact request the production clients would send. Turn 1 holds reasoning and
 * text with provider metadata, a step of two parallel calls (an oversized JSON
 * result that spills, and an image read), text after the calls, a sequential
 * call in its own step, a JSON tool (a timeline search with a multi-key input),
 * a refused call, and a final text step. Turn 2 runs on the same model, on
 * another model, and after a failed reply.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LanguageModelV3Prompt } from '@ai-sdk/provider';
import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import { waitFor } from '../testing/support';
import { MessagesRepository } from './chats-repository';
import { type MessagePart } from './context-builder';
import { continueKeptParts } from './continue-kept-parts';
import { continuedCallSteps, withKeptSteps } from './continue-projection';
import { createRunForMessage } from './run-creation';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { type ScriptedBehavior } from '../runs/scripted-model-client';
import { type ScriptedStep } from '../runs/scripted-model-step';
import {
  bootWorkerHarness,
  createUser,
  dispatchRun,
  seedAndDispatchRun,
  type WorkerHarness,
} from '../runs/worker-harness';
import {
  registerTestOnlyTool,
  unregisterTestOnlyTool,
} from '../tools/registry';
import { type Tool } from '../tools/types';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

vi.setConfig({ testTimeout: 120_000 });

const REASONING_METADATA = { test: { signature: 'reasoning-step-0' } };
const TEXT_METADATA = { test: { itemId: 'text-step-0' } };
const CALL_METADATA = { test: { itemId: 'call-draft' } };
const IMAGE_CALL_METADATA = { test: { itemId: 'call-image' } };
const SECOND_CALL_METADATA = { test: { itemId: 'call-notes' } };
const SEARCH_CALL_METADATA = { test: { itemId: 'call-search' } };
const SPILL_CALL_METADATA = { test: { itemId: 'call-spill' } };
const REFUSED_CALL_METADATA = { test: { itemId: 'call-unknown' } };
const FINAL_TEXT_METADATA = { test: { itemId: 'text-final' } };
const FAILED_REASONING_METADATA = { test: { signature: 'reasoning-doomed' } };
const SECOND_REASONING_METADATA = { test: { signature: 'reasoning-step-1' } };
const FAILED_TEXT_METADATA = { test: { itemId: 'text-doomed' } };
const FINAL_TEXT = 'Turn one done.';

/** The JSON tool's time bound: before the suite creates any chat. */
const TIMELINE_AFTER = new Date(Date.now() - 60 * 60 * 1000).toISOString();

/** A test-only tool whose JSON success exceeds the shared tool-result cap. */
const SPILL_TOOL_ID = 'replay_spill';

/**
 * The real `head` tools bound their own output at the same cap (`read` cuts at
 * 16,000 units), so none of them can exercise the generic spill. This tool
 * returns a plain JSON success over the cap: the cap stores it as an artifact,
 * pins the locator on the result, and cuts the inline value with its notice.
 */
const spillTool: Tool = {
  id: SPILL_TOOL_ID,
  description: 'Returns a JSON payload larger than the tool-result cap.',
  classification: 'read_only',
  inputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  execute: () =>
    Promise.resolve({ status: 'success', payload: 'x'.repeat(20_000) }),
};

/** 1×1 PNG, so the native read returns a real image result. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Prompt = LanguageModelV3Prompt;

/**
 * The turn-1 script: every stored shape the projection has to rebuild. The
 * search call carries a multi-key input whose order the `json` column must
 * keep (a `jsonb` column sorts it to `mode`, then `after`), and its result is
 * a JSON output; the spill call has a result over the cap.
 */
function wholeTurn(draftPath: string, imagePath: string, notesPath: string) {
  return [
    [
      {
        type: 'reasoning',
        id: 'r0',
        text: 'Plan the reads.',
        providerMetadata: REASONING_METADATA,
      },
      {
        type: 'text',
        id: 't0',
        text: 'Reading the draft.',
        providerMetadata: TEXT_METADATA,
      },
      {
        type: 'tool-call',
        toolCallId: 'call-draft',
        toolName: 'read',
        input: { path: draftPath },
        providerMetadata: CALL_METADATA,
      },
      {
        type: 'tool-call',
        toolCallId: 'call-image',
        toolName: 'read',
        input: { path: imagePath },
        providerMetadata: IMAGE_CALL_METADATA,
      },
      { type: 'text', id: 't1', text: 'Both requested.' },
    ],
    [
      {
        type: 'reasoning',
        id: 'r1',
        text: 'The notes look short.',
        providerMetadata: SECOND_REASONING_METADATA,
      },
      {
        type: 'tool-call',
        toolCallId: 'call-notes',
        toolName: 'read',
        input: { path: notesPath },
        providerMetadata: SECOND_CALL_METADATA,
      },
    ],
    [
      { type: 'text', id: 't2', text: 'Checking the timeline.' },
      {
        type: 'tool-call',
        toolCallId: 'call-search',
        toolName: 'search_conversations',
        // Not sorted the way `jsonb` would store it: `after` then `mode`.
        input: { after: TIMELINE_AFTER, mode: 'timeline' },
        providerMetadata: SEARCH_CALL_METADATA,
      },
      {
        type: 'tool-call',
        toolCallId: 'call-spill',
        toolName: SPILL_TOOL_ID,
        input: {},
        providerMetadata: SPILL_CALL_METADATA,
      },
      { type: 'text', id: 't3', text: 'Timeline checked.' },
    ],
    [
      {
        type: 'tool-call',
        toolCallId: 'call-unknown',
        toolName: 'no_such_tool',
        input: {},
        providerMetadata: REFUSED_CALL_METADATA,
      },
    ],
    [
      {
        type: 'text',
        id: 't4',
        text: FINAL_TEXT,
        providerMetadata: FINAL_TEXT_METADATA,
      },
    ],
  ] satisfies ReadonlyArray<ScriptedStep>;
}

/** The one-step reply each turn-2 Run makes. */
const turnTwo = (text: string): ScriptedBehavior => ({
  kind: 'step-script',
  steps: [[{ type: 'text', id: 'next', text }]],
});

describeIfDb('turn replay prefix equality', () => {
  let harness: WorkerHarness;
  let userId: string;
  let directory: string;
  let draftPath: string;
  let imagePath: string;
  let notesPath: string;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL)
      throw new Error('Integration database was not provisioned.');
    directory = await mkdtemp(join(tmpdir(), 'turn-replay-prefix-'));
    draftPath = join(directory, 'draft.md');
    imagePath = join(directory, 'shot.png');
    notesPath = join(directory, 'notes.txt');
    await writeFile(notesPath, 'hello\n');
    await writeFile(imagePath, Buffer.from(PNG_1X1, 'base64'));
    // Registered before boot, so the harness snapshots it into the advertised
    // tool set and its allow-all permission group.
    registerTestOnlyTool(spillTool);
    harness = await bootWorkerHarness({
      allowedTools: ['read', 'search_conversations', SPILL_TOOL_ID],
      nativeExecutorId: 'turn-replay-prefix',
    });
    userId = await createUser(harness.db, 'turn-replay-prefix');
  });

  afterAll(async () => {
    if (harness) await harness.close();
    await rm(directory, { recursive: true, force: true });
    unregisterTestOnlyTool(SPILL_TOOL_ID);
  });

  const terminal = (runId: string) =>
    waitFor(
      async () => {
        const run = await harness.tenantDb.runAs(userId, (tx) =>
          new RunsRepository(tx).findById(runId, userId),
        );
        return run &&
          ['completed', 'failed', 'cancelled', 'expired'].includes(run.status)
          ? run
          : undefined;
      },
      60_000,
      `turn-replay Run ${runId} to settle`,
    );

  /** Registers one model's behavior, then runs one turn of `chatId`. */
  const runTurn = async (input: {
    chatId?: string;
    modelId: string;
    behavior: ScriptedBehavior;
  }): Promise<{ chatId: string; runId: string; status: string }> => {
    harness.models.register(input.modelId, input.behavior);
    harness.models.registerInput(input.modelId, ['text', 'image']);
    const seeded = await seedAndDispatchRun(harness, {
      userId,
      modelId: input.modelId,
      ...(input.chatId !== undefined && { chatId: input.chatId }),
    });
    const run = await terminal(seeded.runId);
    return { chatId: seeded.chatId, runId: seeded.runId, status: run.status };
  };

  /** The prompts the next Run records, in provider-request order. */
  const promptsOf = (from: number): Array<Prompt> =>
    harness.models.prompts.slice(from);

  const assistantParts = async (chatId: string) => {
    const messages = await harness.tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    return messages
      .filter((message) => message.role === 'assistant')
      .flatMap((message) =>
        message.parts.filter((part): part is UnknownRecord => isRecord(part)),
      );
  };

  /** The whole scripted turn 1, with its recorded prompts. */
  const turnOne = async (modelId: string) => {
    const start = harness.models.prompts.length;
    const first = await runTurn({
      modelId,
      behavior: {
        kind: 'step-script',
        steps: wholeTurn(draftPath, imagePath, notesPath),
      },
    });
    expect(first.status).toBe('completed');
    const turnOnePrompts = promptsOf(start);
    const turnOneLast = turnOnePrompts.at(-1);
    if (turnOneLast === undefined)
      throw new Error('Turn 1 made no provider request.');
    return { chatId: first.chatId, start, turnOnePrompts, turnOneLast };
  };

  /** One tool-call part of `prompt`, by call id. */
  const toolCallOf = (
    prompt: Prompt,
    toolCallId: string,
  ): UnknownRecord | undefined => {
    for (const message of prompt) {
      if (message.role !== 'assistant') continue;
      const call = message.content.find(
        (part) =>
          isRecord(part) &&
          part['type'] === 'tool-call' &&
          part['toolCallId'] === toolCallId,
      );
      if (isRecord(call)) return call;
    }
    return undefined;
  };

  /** One tool-result output of `prompt`, by call id. */
  const toolOutputOf = (
    prompt: Prompt,
    toolCallId: string,
  ): UnknownRecord | undefined => {
    for (const message of prompt) {
      if (message.role !== 'tool') continue;
      const result = message.content.find(
        (part) => isRecord(part) && part['toolCallId'] === toolCallId,
      );
      if (isRecord(result) && isRecord(result['output'])) {
        return result['output'];
      }
    }
    return undefined;
  };

  /** A prompt with every reasoning part and every provider metadata removed. */
  const omitPrivateParts = (prompt: Prompt): Array<unknown> =>
    // SAFETY: a recorded prompt is a JSON-shaped array of provider messages;
    // this reads only the keys it names and checks each before use.
    (prompt as ReadonlyArray<unknown>).map((message) => {
      if (!isRecord(message)) return message;
      const content = message['content'];
      if (!Array.isArray(content)) return message;
      const parts: Array<unknown> = content;
      return {
        ...message,
        content: parts.flatMap((part) => {
          if (!isRecord(part)) return [part];
          if (part['type'] === 'reasoning') return [];
          const { providerOptions: _opaque, ...rest } = part;
          return [rest];
        }),
      };
    });

  it('turn 2 on the same model starts with turn 1’s last request and its response', async () => {
    const modelId = `prefix-${randomUUID()}`;
    const { chatId, start, turnOnePrompts, turnOneLast } =
      await turnOne(modelId);

    // Turn 1's stored shape: steps, provider metadata, the spill artifact, the
    // JSON result, the image, and the refusal.
    const parts = await assistantParts(chatId);
    const toolParts = parts.filter((part) =>
      String(part['type']).startsWith('tool-'),
    );
    expect(toolParts.map((part) => part['step'])).toEqual([0, 0, 1, 2, 2, 3]);
    expect(parts.filter((part) => part['type'] === 'text')).toHaveLength(5);
    expect(parts.filter((part) => part['type'] === 'reasoning')).toHaveLength(
      2,
    );

    const searchPart = toolParts.find(
      (part) => part['toolCallId'] === 'call-search',
    );
    expect(searchPart).toMatchObject({
      state: 'output-available',
      step: 2,
      providerMetadata: SEARCH_CALL_METADATA,
    });
    // The member order a `json` column keeps and a `jsonb` column would sort.
    const searchInput = searchPart?.['input'];
    expect(isRecord(searchInput) ? Object.keys(searchInput) : []).toEqual([
      'after',
      'mode',
    ]);
    expect(toolOutputOf(turnOneLast, 'call-search')).toMatchObject({
      type: 'json',
      value: { status: 'success' },
    });
    const liveSearchInput = toolCallOf(turnOneLast, 'call-search')?.['input'];
    expect(
      isRecord(liveSearchInput) ? Object.keys(liveSearchInput) : [],
    ).toEqual(['after', 'mode']);

    const imagePart = toolParts.find(
      (part) => part['toolCallId'] === 'call-image',
    );
    expect(imagePart).toMatchObject({
      state: 'output-available',
      providerMetadata: IMAGE_CALL_METADATA,
    });
    expect(imagePart?.['retainedMedia']).toBeDefined();

    // The oversized JSON result spilled: the part names exactly one artifact
    // locator, and the cap notice names it (the notice repeats it as the
    // continuation address, and no separate `Artifact:` line is added).
    const spilled = toolParts.find(
      (part) => part['toolCallId'] === 'call-spill',
    );
    expect(spilled?.['state']).toBe('output-available');
    const artifact = spilled?.['artifact'];
    expect(artifact).toMatch(/^artifact:\/\/replay_spill-\d+$/u);
    const spilledOutput = spilled?.['output'];
    if (!isRecord(spilledOutput))
      throw new Error('Expected the spilled result object');
    expect(spilledOutput['artifact']).toBe(artifact);
    const notice = spilledOutput['truncationNotice'];
    expect(isString(notice)).toBe(true);
    if (!isString(notice)) throw new Error('Expected a cap notice');
    expect(notice).toContain(String(artifact));
    expect(notice.match(/\[full result: /gu)).toHaveLength(1);
    expect(JSON.stringify(spilled)).not.toContain('Artifact:');

    const refused = parts.find((part) => part['toolCallId'] === 'call-unknown');
    expect(refused).toMatchObject({
      type: 'tool-no_such_tool',
      state: 'output-error',
      step: 3,
      providerMetadata: REFUSED_CALL_METADATA,
    });
    expect(refused?.['sdkRefusal']).toBeDefined();

    // Turn 2 replays the same conversation on the same model.
    const second = await runTurn({
      chatId,
      modelId,
      behavior: turnTwo('Turn two done.'),
    });
    expect(second.status).toBe('completed');
    const turnTwoFirst = promptsOf(start + turnOnePrompts.length)[0];
    if (turnTwoFirst === undefined)
      throw new Error('Turn 2 made no provider request.');

    // The previous request, byte for byte — member order included.
    expect(JSON.stringify(turnTwoFirst.slice(0, turnOneLast.length))).toBe(
      JSON.stringify(turnOneLast),
    );
    // Then the response to that request: the final text step with the provider
    // metadata the live step sent, then turn 2's own user message.
    const tail = turnTwoFirst.slice(turnOneLast.length);
    expect(JSON.stringify(tail[0])).toBe(
      JSON.stringify({
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: FINAL_TEXT,
            providerOptions: FINAL_TEXT_METADATA,
          },
        ],
      }),
    );
    expect(tail[1]?.role).toBe('user');
  });

  it('a model switch keeps the previous request less the omitted parts', async () => {
    const firstModel = `prefix-a-${randomUUID()}`;
    const secondModel = `prefix-b-${randomUUID()}`;
    const { chatId, start, turnOnePrompts, turnOneLast } =
      await turnOne(firstModel);

    const second = await runTurn({
      chatId,
      modelId: secondModel,
      behavior: turnTwo('Switched.'),
    });
    expect(second.status).toBe('completed');
    const turnTwoFirst = promptsOf(start + turnOnePrompts.length)[0];
    if (turnTwoFirst === undefined)
      throw new Error('Turn 2 made no provider request.');

    // The top-level prompt is the one part a model switch replaces, so the
    // comparison starts after it (model-system-prompts).
    const expected = omitPrivateParts(turnOneLast);
    expect(JSON.stringify(turnTwoFirst.slice(1, expected.length))).toBe(
      JSON.stringify(expected.slice(1)),
    );
    const tail = turnTwoFirst.slice(expected.length);
    expect(JSON.stringify(tail[0])).toBe(
      JSON.stringify({
        role: 'assistant',
        content: [{ type: 'text', text: FINAL_TEXT }],
      }),
    );
    expect(tail[1]?.role).toBe('user');
    const serialized = JSON.stringify(turnTwoFirst);
    expect(serialized).not.toContain('"reasoning"');
    expect(serialized).not.toContain('reasoning-step-0');
    expect(serialized).not.toContain('text-step-0');
    expect(serialized).not.toContain('"itemId"');
    // The tool activity itself survives the switch, JSON result included.
    expect(serialized).toContain('call-notes');
    expect(serialized).toContain('hello');
    expect(serialized).toContain('"type":"json"');
  });

  it('a failed reply keeps the previous request less the omitted parts', async () => {
    const modelId = `prefix-fail-${randomUUID()}`;
    const start = harness.models.prompts.length;
    const first = await runTurn({
      modelId,
      behavior: {
        kind: 'step-script',
        steps: [
          [
            {
              type: 'reasoning',
              id: 'r0',
              text: 'Plan the read.',
              providerMetadata: REASONING_METADATA,
            },
            {
              type: 'text',
              id: 't0',
              text: 'Reading notes.',
              providerMetadata: FAILED_TEXT_METADATA,
            },
            {
              type: 'tool-call',
              toolCallId: 'call-notes',
              toolName: 'read',
              input: { path: notesPath },
              providerMetadata: SECOND_CALL_METADATA,
            },
          ],
          [
            {
              type: 'reasoning',
              id: 'doomed',
              text: 'Thinking before the drop.',
              providerMetadata: FAILED_REASONING_METADATA,
            },
            { type: 'error', message: 'scripted provider failure' },
          ],
        ],
      },
    });
    expect(first.status).toBe('failed');
    const turnOnePrompts = promptsOf(start);
    const turnOneLast = turnOnePrompts.at(-1);
    if (turnOneLast === undefined)
      throw new Error('Turn 1 made no provider request.');

    const parts = await assistantParts(first.chatId);
    expect(JSON.stringify(parts)).toContain('Thinking before the drop.');
    // The failed reply stores the step-0 text and call with their step number,
    // so replay must keep them in ONE assistant message (the split-step
    // mutation is what this pins).
    expect(
      parts.find((part) => part['text'] === 'Reading notes.')?.['step'],
    ).toBe(0);
    expect(
      parts.find((part) => part['toolCallId'] === 'call-notes')?.['step'],
    ).toBe(0);
    expect(turnOneLast.some((message) => message.role === 'tool')).toBe(true);
    const grouped = turnOneLast.find(
      (message) =>
        message.role === 'assistant' &&
        Array.isArray(message.content) &&
        message.content.some(
          (part) => isRecord(part) && part['text'] === 'Reading notes.',
        ),
    );
    if (grouped === undefined || !Array.isArray(grouped.content))
      throw new Error('Expected the step-0 assistant message');
    expect(grouped.content).toEqual([
      expect.objectContaining({
        type: 'reasoning',
        text: 'Plan the read.',
        providerOptions: REASONING_METADATA,
      }),
      expect.objectContaining({
        type: 'text',
        text: 'Reading notes.',
        providerOptions: FAILED_TEXT_METADATA,
      }),
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: 'call-notes',
        toolName: 'read',
      }),
    ]);

    const second = await runTurn({
      chatId: first.chatId,
      modelId,
      behavior: turnTwo('Recovered.'),
    });
    expect(second.status).toBe('completed');
    const turnTwoFirst = promptsOf(start + turnOnePrompts.length)[0];
    if (turnTwoFirst === undefined)
      throw new Error('Turn 2 made no provider request.');

    const expected = omitPrivateParts(turnOneLast);
    expect(JSON.stringify(turnTwoFirst.slice(0, expected.length))).toBe(
      JSON.stringify(expected),
    );
    // The failed reply stored a reasoning part only, so it adds nothing.
    expect(turnTwoFirst.length).toBeGreaterThan(expected.length);
    expect(turnTwoFirst[expected.length]?.role).toBe('user');
    const serialized = JSON.stringify(turnTwoFirst);
    expect(serialized).not.toContain('reasoning-doomed');
    expect(serialized).not.toContain('Thinking before the drop.');
    expect(serialized).not.toContain('reasoning-step-0');
    expect(serialized).toContain('hello');
  });

  it('a Continue request sends the kept steps the source Run’s live step sent', async () => {
    const modelId = `prefix-continue-${randomUUID()}`;
    const start = harness.models.prompts.length;
    harness.models.register(modelId, {
      kind: 'step-script',
      steps: [
        [
          {
            type: 'reasoning',
            id: 'r0',
            text: 'Plan the read.',
            providerMetadata: REASONING_METADATA,
          },
          {
            type: 'text',
            id: 't0',
            text: 'Reading notes.',
            providerMetadata: FAILED_TEXT_METADATA,
          },
          {
            type: 'tool-call',
            toolCallId: 'call-notes',
            toolName: 'read',
            input: { path: notesPath },
            providerMetadata: SECOND_CALL_METADATA,
          },
        ],
        [
          {
            type: 'reasoning',
            id: 'doomed',
            text: 'Thinking before the drop.',
            providerMetadata: FAILED_REASONING_METADATA,
          },
          { type: 'error', message: 'scripted provider failure' },
        ],
      ],
    });
    harness.models.registerInput(modelId, ['text', 'image']);
    const seeded = await seedAndDispatchRun(harness, { userId, modelId });
    const source = await terminal(seeded.runId);
    expect(source.status).toBe('failed');
    const sourcePrompts = promptsOf(start);
    const sourceLast = sourcePrompts.at(-1);
    if (sourceLast === undefined)
      throw new Error('The source Run made no provider request.');
    // The failed step's request carried the kept step: one assistant message
    // with its reasoning, text, and call, then the result.
    expect(sourceLast.some((message) => message.role === 'tool')).toBe(true);
    expect(sourceLast.at(-1)?.role).toBe('tool');

    // Admit the Continue Run the way the API does: the reply through its last
    // settled tool part, numbered by admission, then the `run.continued`
    // event.
    const runId = await harness.tenantDb.runAs(userId, async (tx) => {
      const turn = await new MessagesRepository(tx).findTurnState(
        seeded.chatId,
        userId,
        seeded.userMessage.id,
      );
      if (turn.userMessage === undefined || turn.assistantMessage === undefined)
        throw new Error('The failed turn left no reply to continue.');
      // SAFETY: the reply's parts are stored UI parts, and admission
      // re-validates every part it reads.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      const kept = continueKeptParts(
        turn.assistantMessage.parts,
      ) as ReadonlyArray<MessagePart>;
      const sourceEvents = await new RunEventsRepository(tx).listByRunId(
        seeded.runId,
        userId,
        { eventTypes: ['tool.requested'] },
      );
      const { run } = await createRunForMessage(
        tx,
        {
          userId,
          chatId: seeded.chatId,
          modelId,
          effort: undefined,
          permissionMode: 'default',
          targetRunId: randomUUID(),
          followUp: {
            action: 'continue',
            sourceRunId: seeded.runId,
            keptParts: withKeptSteps(
              kept,
              continuedCallSteps({ keptParts: kept, sourceEvents }),
            ),
            replacesUsage: true,
          },
        },
        turn.userMessage,
      );
      return run.id;
    });
    harness.models.register(modelId, turnTwo('Continued.'));
    await dispatchRun({
      queue: harness.queue,
      chatId: seeded.chatId,
      runId,
      userId,
      modelId,
      userMessage: seeded.userMessage,
    });
    const continued = await terminal(runId);
    expect(continued.status).toBe('completed');

    const continueFirst = promptsOf(start + sourcePrompts.length)[0];
    if (continueFirst === undefined)
      throw new Error('The Continue Run made no provider request.');
    // The Continue Run sends the kept step exactly as the source Run's live
    // step sent it — HAPPY path for turn-replay's Continue scenario, and the
    // reasoning of the failed Run, metadata included (reasoning-output D7).
    expect(JSON.stringify(continueFirst)).toBe(JSON.stringify(sourceLast));
  });
});
