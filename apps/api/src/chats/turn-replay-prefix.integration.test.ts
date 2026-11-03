/**
 * Prefix equality (design D14): the first request of a turn starts with what
 * the previous turn's last request sent, then the response to that request.
 *
 * The whole-step scripted model client drives the real AI SDK and the
 * production seams, so the recorded prompt of each provider request is the
 * exact request the production clients would send. Turn 1 holds reasoning and
 * text with provider metadata, a step of two parallel calls (a spilled read and
 * an image read), text after the calls, a sequential call in its own step, a
 * refused call, and a final text step. Turn 2 runs on the same model, on
 * another model, and after a failed reply.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LanguageModelV3Prompt } from '@ai-sdk/provider';
import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';

import { waitFor } from '../testing/support';
import { MessagesRepository } from './chats-repository';
import { RunsRepository } from '../runs/runs-repository';
import { type ScriptedBehavior } from '../runs/scripted-model-client';
import { type ScriptedStep } from '../runs/scripted-model-step';
import {
  bootWorkerHarness,
  createUser,
  seedAndDispatchRun,
  type WorkerHarness,
} from '../runs/worker-harness';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

vi.setConfig({ testTimeout: 120_000 });

const REASONING_METADATA = { test: { signature: 'reasoning-step-0' } };
const TEXT_METADATA = { test: { itemId: 'text-step-0' } };
const CALL_METADATA = { test: { itemId: 'call-draft' } };
const IMAGE_CALL_METADATA = { test: { itemId: 'call-image' } };
const SECOND_CALL_METADATA = { test: { itemId: 'call-notes' } };
const REFUSED_CALL_METADATA = { test: { itemId: 'call-unknown' } };
const FINAL_TEXT_METADATA = { test: { itemId: 'text-final' } };
const FAILED_REASONING_METADATA = { test: { signature: 'reasoning-doomed' } };
const SECOND_REASONING_METADATA = { test: { signature: 'reasoning-step-1' } };
const FAILED_TEXT_METADATA = { test: { itemId: 'text-doomed' } };
const FINAL_TEXT = 'Turn one done.';

/** 1×1 PNG, so the native read returns a real image result. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Prompt = LanguageModelV3Prompt;

/** The turn-1 script: every stored shape the projection has to rebuild. */
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
        id: 't2',
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
    // Over the 16,000-unit cap, so its result spills to an artifact.
    await writeFile(
      draftPath,
      Array.from(
        { length: 5000 },
        (_, index) => `${index}: ${'x'.repeat(120)}`,
      ).join('\n'),
    );
    await writeFile(imagePath, Buffer.from(PNG_1X1, 'base64'));
    await writeFile(notesPath, 'hello\n');
    harness = await bootWorkerHarness({
      allowedTools: ['read'],
      nativeExecutorId: 'turn-replay-prefix',
    });
    userId = await createUser(harness.db, 'turn-replay-prefix');
  });

  afterAll(async () => {
    if (harness) await harness.close();
    await rm(directory, { recursive: true, force: true });
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
    input?: ReadonlyArray<'text' | 'image' | 'pdf'>;
  }): Promise<{ chatId: string; runId: string; status: string }> => {
    harness.models.register(input.modelId, input.behavior);
    if (input.input !== undefined) {
      harness.models.registerInput(input.modelId, input.input);
    }
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

  it('turn 1 stores the whole turn: steps, provider metadata, a spill, an image, and a refusal', async () => {
    const modelId = `prefix-${randomUUID()}`;
    const turn = await runTurn({
      modelId,
      behavior: {
        kind: 'step-script',
        steps: wholeTurn(draftPath, imagePath, notesPath),
      },
      input: ['text', 'image'],
    });

    expect(turn.status).toBe('completed');
    const parts = await assistantParts(turn.chatId);
    const toolParts = parts.filter((part) => part['type'] === 'tool-read');
    expect(toolParts.map((part) => part['step'])).toEqual([0, 0, 1]);
    expect(parts.filter((part) => part['type'] === 'text')).toHaveLength(3);
    expect(parts.filter((part) => part['type'] === 'reasoning')).toHaveLength(
      2,
    );

    const imagePart = toolParts.find(
      (part) => part['toolCallId'] === 'call-image',
    );
    expect(imagePart).toMatchObject({
      state: 'output-available',
      providerMetadata: IMAGE_CALL_METADATA,
    });
    expect(imagePart?.['retainedMedia']).toBeDefined();

    const spilled = toolParts.find(
      (part) => part['toolCallId'] === 'call-draft',
    );
    const spilledText = JSON.stringify(spilled);
    // The result is over the 16,000-unit cap, so the live loop capped it; an
    // artifact locator, when the Run can read its artifacts, appears once.
    expect(spilledText).toContain('truncated');
    expect(spilledText.match(/artifact:\/\//gu)?.length ?? 0).toBeLessThan(2);

    const refused = parts.find((part) => part['toolCallId'] === 'call-unknown');
    expect(refused).toMatchObject({
      type: 'tool-no_such_tool',
      state: 'output-error',
      step: 2,
      providerMetadata: REFUSED_CALL_METADATA,
    });
    expect(refused?.['sdkRefusal']).toBeDefined();
  });

  it('turn 2 on the same model starts with turn 1’s last request and its response', async () => {
    const modelId = `prefix-${randomUUID()}`;
    const first = await runTurn({
      modelId,
      behavior: {
        kind: 'step-script',
        steps: wholeTurn(draftPath, imagePath, notesPath),
      },
      input: ['text', 'image'],
    });
    expect(first.status).toBe('completed');
    const turnOnePrompts = promptsOf(0);
    const turnOneLast = turnOnePrompts.at(-1);
    if (turnOneLast === undefined)
      throw new Error('Turn 1 made no provider request.');

    const second = await runTurn({
      chatId: first.chatId,
      modelId,
      behavior: turnTwo('Turn two done.'),
      input: ['text', 'image'],
    });
    expect(second.status).toBe('completed');
    const turnTwoPrompts = promptsOf(turnOnePrompts.length);
    const turnTwoFirst = turnTwoPrompts[0];
    if (turnTwoFirst === undefined)
      throw new Error('Turn 2 made no provider request.');

    // The previous request, byte for byte.
    expect(turnTwoFirst.slice(0, turnOneLast.length)).toEqual(turnOneLast);
    // Then the response to that request: the final text step with the provider
    // metadata the live step sent, then turn 2's own user message.
    const tail = turnTwoFirst.slice(turnOneLast.length);
    expect(tail[0]).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: FINAL_TEXT,
          providerOptions: FINAL_TEXT_METADATA,
        },
      ],
    });
    expect(tail[1]?.role).toBe('user');
  });

  it('a model switch keeps the previous request less the omitted parts', async () => {
    const firstModel = `prefix-a-${randomUUID()}`;
    const secondModel = `prefix-b-${randomUUID()}`;
    const first = await runTurn({
      modelId: firstModel,
      behavior: {
        kind: 'step-script',
        steps: wholeTurn(draftPath, imagePath, notesPath),
      },
      input: ['text', 'image'],
    });
    expect(first.status).toBe('completed');
    const turnOnePrompts = promptsOf(0);
    const turnOneLast = turnOnePrompts.at(-1);
    if (turnOneLast === undefined)
      throw new Error('Turn 1 made no provider request.');

    const second = await runTurn({
      chatId: first.chatId,
      modelId: secondModel,
      behavior: turnTwo('Switched.'),
      // The same media forms, so only the model rule differs.
      input: ['text', 'image'],
    });
    expect(second.status).toBe('completed');
    const turnTwoFirst = promptsOf(turnOnePrompts.length)[0];
    if (turnTwoFirst === undefined)
      throw new Error('Turn 2 made no provider request.');

    // The top-level prompt is the one part a model switch replaces, so the
    // comparison starts after it (model-system-prompts).
    const expected = omitPrivateParts(turnOneLast);
    expect(turnTwoFirst.slice(1, expected.length)).toEqual(expected.slice(1));
    const tail = turnTwoFirst.slice(expected.length);
    expect(tail[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: FINAL_TEXT }],
    });
    expect(tail[1]?.role).toBe('user');
    const serialized = JSON.stringify(turnTwoFirst);
    expect(serialized).not.toContain('"reasoning"');
    expect(serialized).not.toContain('reasoning-step-0');
    expect(serialized).not.toContain('text-step-0');
    expect(serialized).not.toContain('"itemId"');
    // The tool activity itself survives the switch.
    expect(serialized).toContain('call-notes');
    expect(serialized).toContain('hello');
  });

  it('a failed reply keeps the previous request less the omitted parts', async () => {
    const modelId = `prefix-fail-${randomUUID()}`;
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
      input: ['text', 'image'],
    });
    expect(first.status).toBe('failed');
    const turnOnePrompts = promptsOf(0);
    const turnOneLast = turnOnePrompts.at(-1);
    if (turnOneLast === undefined)
      throw new Error('Turn 1 made no provider request.');

    const parts = await assistantParts(first.chatId);
    expect(JSON.stringify(parts)).toContain('Thinking before the drop.');

    const second = await runTurn({
      chatId: first.chatId,
      modelId,
      behavior: turnTwo('Recovered.'),
      input: ['text', 'image'],
    });
    expect(second.status).toBe('completed');
    const turnTwoFirst = promptsOf(turnOnePrompts.length)[0];
    if (turnTwoFirst === undefined)
      throw new Error('Turn 2 made no provider request.');

    const expected = omitPrivateParts(turnOneLast);
    expect(turnTwoFirst.slice(0, expected.length)).toEqual(expected);
    // The failed reply stored a reasoning part only, so it adds nothing.
    expect(turnTwoFirst.length).toBeGreaterThan(expected.length);
    expect(turnTwoFirst[expected.length]?.role).toBe('user');
    const serialized = JSON.stringify(turnTwoFirst);
    expect(serialized).not.toContain('reasoning-doomed');
    expect(serialized).not.toContain('Thinking before the drop.');
    expect(serialized).not.toContain('reasoning-step-0');
    expect(serialized).toContain('hello');
  });
});
