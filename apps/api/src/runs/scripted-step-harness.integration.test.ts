/**
 * The whole-step scripted model client (design D14, harness layer): a
 * scripted provider step runs through the REAL `streamText` pipeline, so the
 * stored transcript proves what the production seams did with reasoning, text,
 * parallel calls, provider metadata, refused calls, and a dropped stream —
 * and the next step's recorded prompt proves the SDK built it from the
 * previous step's response messages.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';

import { MessagesRepository } from '../chats/chats-repository';
import { waitFor } from '../testing/support';
import { reconstructDurableAssistant } from './assistant-transcript';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { type ScriptedBehavior } from './scripted-model-client';
import {
  bootWorkerHarness,
  createUser,
  seedAndDispatchRun,
  type WorkerHarness,
} from './worker-harness';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

vi.setConfig({ testTimeout: 90_000 });

const REASONING_METADATA = { test: { signature: 'reasoning-step-0' } };
const TEXT_METADATA = { test: { itemId: 'text-before-call' } };
const CALL_METADATA = { test: { itemId: 'call-read' } };
const UNKNOWN_CALL_METADATA = { test: { itemId: 'call-unknown' } };
const SECOND_REASONING_METADATA = { test: { signature: 'reasoning-step-1' } };
const INVALID_CALL_METADATA = { test: { itemId: 'call-invalid' } };
const FINAL_TEXT_METADATA = { test: { itemId: 'text-final' } };
const FAILED_REASONING_METADATA = { test: { signature: 'reasoning-doomed' } };

/** The JSON records a stored parts array holds, skipping anything malformed. */
function storedParts(parts: ReadonlyArray<unknown>): Array<UnknownRecord> {
  return parts.filter((part): part is UnknownRecord => isRecord(part));
}

/** Every stored part of one type, in transcript order. */
function partsOf(
  parts: ReadonlyArray<UnknownRecord>,
  type: string,
): Array<UnknownRecord> {
  return parts.filter((part) => part['type'] === type);
}

/** The stored tool part a call id names. */
function partWithCallId(
  parts: ReadonlyArray<UnknownRecord>,
  toolCallId: string,
): UnknownRecord | undefined {
  return parts.find((part) => part['toolCallId'] === toolCallId);
}

describeIfDb('whole-step scripted model client', () => {
  let harness: WorkerHarness;
  let userId: string;
  let directory: string;
  let filePath: string;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL)
      throw new Error('Integration database was not provisioned.');
    directory = await mkdtemp(join(tmpdir(), 'step-script-harness-'));
    filePath = join(directory, 'notes.txt');
    await writeFile(filePath, 'hello\n');
    harness = await bootWorkerHarness({
      allowedTools: ['read'],
      nativeExecutorId: 'step-script-harness',
    });
    userId = await createUser(harness.db, 'step-script-harness');
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
      30_000,
      `scripted step Run ${runId} to settle`,
    );

  const assistantParts = async (chatId: string) => {
    const messages = await harness.tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    const assistant = messages.find((message) => message.role === 'assistant');
    if (assistant === undefined)
      throw new Error('The Run stored no assistant message.');
    return storedParts(assistant.parts);
  };

  it('stores each scripted step through the production seams and feeds its response to the next step', async () => {
    const modelId = `step-script-${randomUUID()}`;
    const behavior: ScriptedBehavior = {
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
            text: 'Reading first. ',
            providerMetadata: TEXT_METADATA,
          },
          {
            type: 'tool-call',
            toolCallId: 'call-read',
            toolName: 'read',
            input: { path: filePath },
            providerMetadata: CALL_METADATA,
          },
          {
            type: 'tool-call',
            toolCallId: 'call-unknown',
            toolName: 'no_such_tool',
            input: {},
            providerMetadata: UNKNOWN_CALL_METADATA,
          },
          { type: 'text', id: 't1', text: 'Both requested. ' },
        ],
        [
          {
            type: 'reasoning',
            id: 'r1',
            text: 'Second look.',
            providerMetadata: SECOND_REASONING_METADATA,
          },
          {
            type: 'tool-call',
            toolCallId: 'call-invalid',
            toolName: 'read',
            input: '{"path": ',
            providerMetadata: INVALID_CALL_METADATA,
          },
        ],
        [
          {
            type: 'text',
            id: 't2',
            text: 'Finished.',
            providerMetadata: FINAL_TEXT_METADATA,
          },
        ],
      ],
    };
    harness.models.register(modelId, behavior);
    const promptCount = harness.models.prompts.length;

    const seeded = await seedAndDispatchRun(harness, { userId, modelId });
    expect((await terminal(seeded.runId)).status).toBe('completed');
    const parts = await assistantParts(seeded.chatId);

    // Step 0: reasoning, text, both calls, then text again — every part of
    // the step carries its own number and the provider metadata its wire part
    // carried.
    expect(partsOf(parts, 'reasoning')).toEqual([
      expect.objectContaining({
        type: 'reasoning',
        text: 'Plan the read.',
        step: 0,
        providerMetadata: REASONING_METADATA,
      }),
      expect.objectContaining({
        type: 'reasoning',
        text: 'Second look.',
        step: 1,
        providerMetadata: SECOND_REASONING_METADATA,
      }),
    ]);
    expect(partsOf(parts, 'text')).toEqual([
      expect.objectContaining({
        type: 'text',
        text: 'Reading first. ',
        step: 0,
        providerMetadata: TEXT_METADATA,
      }),
      expect.objectContaining({
        type: 'text',
        text: 'Both requested. ',
        step: 0,
      }),
      expect.objectContaining({
        type: 'text',
        text: 'Finished.',
        step: 2,
        providerMetadata: FINAL_TEXT_METADATA,
      }),
    ]);

    expect(partWithCallId(parts, 'call-read')).toMatchObject({
      type: 'tool-read',
      state: 'output-available',
      input: { path: filePath },
      step: 0,
      providerMetadata: CALL_METADATA,
    });
    const unknownPart = partWithCallId(parts, 'call-unknown');
    expect(unknownPart).toMatchObject({
      type: 'tool-no_such_tool',
      state: 'output-error',
      step: 0,
      providerMetadata: UNKNOWN_CALL_METADATA,
    });
    const unknownRefusal = unknownPart?.['sdkRefusal'];
    if (!isRecord(unknownRefusal))
      throw new Error('The unknown call stored no SDK refusal.');
    expect(unknownRefusal['input']).toEqual({});
    expect(String(unknownRefusal['errorText'])).toContain('no_such_tool');

    const invalidPart = partWithCallId(parts, 'call-invalid');
    expect(invalidPart).toMatchObject({
      type: 'tool-read',
      state: 'output-error',
      step: 1,
      providerMetadata: INVALID_CALL_METADATA,
    });
    const invalidRefusal = invalidPart?.['sdkRefusal'];
    if (!isRecord(invalidRefusal))
      throw new Error('The invalid call stored no SDK refusal.');
    expect(invalidRefusal['input']).toEqual({});
    expect(String(invalidRefusal['errorText'])).toContain('JSON');

    // The SDK built step 1 and step 2 from the previous step's response
    // messages. Step 1's request carries step 0's reasoning, both texts, and
    // both calls with their provider options; the tool message carries the
    // results so the model can answer from them.
    const prompts = harness.models.prompts.slice(promptCount);
    const secondPrompt = prompts[1];
    if (secondPrompt === undefined)
      throw new Error('The Run made no second provider request.');
    const assistantMessage = secondPrompt.find(
      (message) => message.role === 'assistant',
    );
    if (assistantMessage?.role !== 'assistant')
      throw new Error('Step 2 carried no assistant message.');
    expect(assistantMessage.content).toContainEqual(
      expect.objectContaining({
        type: 'reasoning',
        text: 'Plan the read.',
        providerOptions: REASONING_METADATA,
      }),
    );
    expect(assistantMessage.content).toContainEqual(
      expect.objectContaining({
        type: 'text',
        text: 'Reading first. ',
        providerOptions: TEXT_METADATA,
      }),
    );
    expect(assistantMessage.content).toContainEqual(
      expect.objectContaining({
        type: 'text',
        text: 'Both requested. ',
      }),
    );
    const readCall = assistantMessage.content.find(
      (part) => part.type === 'tool-call' && part.toolCallId === 'call-read',
    );
    expect(readCall).toMatchObject({
      toolName: 'read',
      input: { path: filePath },
      providerOptions: CALL_METADATA,
    });
    expect(
      assistantMessage.content.some(
        (part) =>
          part.type === 'tool-call' && part.toolCallId === 'call-unknown',
      ),
    ).toBe(true);
    const toolResults = secondPrompt.flatMap((message) =>
      message.role === 'tool'
        ? message.content.filter((part) => part.type === 'tool-result')
        : [],
    );
    expect(toolResults.map((part) => part.toolCallId)).toEqual(
      expect.arrayContaining(['call-read', 'call-unknown']),
    );
  });

  it('fails the Run on a stream error after a reasoning part and keeps that part', async () => {
    const modelId = `step-script-failure-${randomUUID()}`;
    harness.models.register(modelId, {
      kind: 'step-script',
      steps: [
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

    const seeded = await seedAndDispatchRun(harness, { userId, modelId });
    expect((await terminal(seeded.runId)).status).toBe('failed');

    const parts = await assistantParts(seeded.chatId);
    expect(partsOf(parts, 'reasoning')).toEqual([
      expect.objectContaining({
        type: 'reasoning',
        text: 'Thinking before the drop.',
        step: 0,
        providerMetadata: FAILED_REASONING_METADATA,
      }),
    ]);

    // The durable rebuild a later reader runs must agree with the live stored
    // transcript, reasoning included.
    const events = await harness.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(seeded.runId, userId),
    );
    expect(reconstructDurableAssistant(events).collector.parts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'reasoning',
          text: 'Thinking before the drop.',
          providerMetadata: FAILED_REASONING_METADATA,
        }),
      ]),
    );
  });
});
