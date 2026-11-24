/**
 * One request's tool-call id map (design D13 of `model-roles`). Pure: stored
 * ids in, the ids one request sends out, and the stored ids never change.
 */

import { createHash } from 'node:crypto';
import type { ModelMessage } from 'ai';

import {
  createToolCallIdMap,
  normalizeStepToolCallIds,
  WIRE_TOOL_CALL_ID,
  type ToolCallIdMap,
} from './tool-call-ids';

/** The hash half of the mapped form, computed the way the module states it. */
function hashOf(storedId: string): string {
  return createHash('sha256').update(storedId).digest('hex').slice(0, 8);
}

/** Resolve pairs of (stored id, own model) in one request, in order. */
function resolveAll(
  ids: ToolCallIdMap,
  entries: ReadonlyArray<[string, boolean]>,
): Array<string> {
  return entries.map(([storedId, ownModel]) => ids.resolve(storedId, ownModel));
}

describe('createToolCallIdMap', () => {
  it('keeps an id the request’s own model produced', () => {
    const ids = createToolCallIdMap();

    expect(ids.resolve('call-abc_123', true)).toBe('call-abc_123');
  });

  it('maps an id of another wire to the provider-safe pattern', () => {
    const ids = createToolCallIdMap();
    const wireId = ids.resolve('call.with.dots', false);

    expect(wireId).toMatch(WIRE_TOOL_CALL_ID);
    expect(wireId).toMatch(/^call_with_dots_[0-9a-f]{8}$/);
    // The same stored id in a second request maps the same way.
    expect(createToolCallIdMap().resolve('call.with.dots', false)).toBe(wireId);
  });

  it('keeps two ids that sanitize alike distinct', () => {
    const ids = createToolCallIdMap();

    const [dotted, colon] = resolveAll(ids, [
      ['call.1', false],
      ['call:1', false],
    ]);

    expect(dotted).toMatch(WIRE_TOOL_CALL_ID);
    expect(colon).toMatch(WIRE_TOOL_CALL_ID);
    expect(dotted).not.toBe(colon);
  });

  it('remaps a repeated id the request’s own model produced', () => {
    const ids = createToolCallIdMap();

    const [first, second] = resolveAll(ids, [
      ['call-dup', true],
      ['call-dup', true],
    ]);

    expect(first).toBe('call-dup');
    expect(second).toMatch(WIRE_TOOL_CALL_ID);
    expect(second).not.toBe(first);
  });

  it('keeps an already-safe id of another wire unless an earlier part used it', () => {
    const ids = createToolCallIdMap();

    const [first, second] = resolveAll(ids, [
      ['call-shared', false],
      ['call-shared', true],
    ]);

    expect(first).toBe('call-shared');
    expect(second).toMatch(WIRE_TOOL_CALL_ID);
    expect(second).not.toBe(first);
  });

  it('cuts a long id and stays inside the 40-character bound', () => {
    const long = 'x'.repeat(60);
    const ids = createToolCallIdMap();
    const wireId = ids.resolve(long, false);

    expect(wireId).toMatch(WIRE_TOOL_CALL_ID);
    expect(wireId).toHaveLength(37);
    expect(wireId).toBe(`${'x'.repeat(28)}_${hashOf(long)}`);
  });

  it('adds a counter when the mapped form is already used', () => {
    const mappedForm = `call_1_${hashOf('call.1')}`;
    const ids = createToolCallIdMap();

    const [kept, collision] = resolveAll(ids, [
      [mappedForm, true],
      ['call.1', false],
    ]);

    expect(kept).toBe(mappedForm);
    expect(collision).toBe(`${mappedForm}_01`);
    expect(collision.length).toBeLessThanOrEqual(40);
    expect(collision).toMatch(WIRE_TOOL_CALL_ID);
  });

  it('gives one id per stored call, so a call and its result share it', () => {
    const ids = createToolCallIdMap();
    // The projection resolves once per stored observation and uses the answer
    // for both parts; a second resolution is a different part and must differ.
    const shared = ids.resolve('call.with.dots', false);
    const other = ids.resolve('call.with.dots', false);

    expect(other).not.toBe(shared);
    expect(shared).toMatch(WIRE_TOOL_CALL_ID);
    expect(other).toMatch(WIRE_TOOL_CALL_ID);
  });
});

describe('normalizeStepToolCallIds', () => {
  const callPart = (toolCallId: string) => ({
    type: 'tool-call' as const,
    toolCallId,
    toolName: 'read',
    input: {},
  });

  const resultPart = (toolCallId: string) => ({
    type: 'tool-result' as const,
    toolCallId,
    toolName: 'read',
    output: { type: 'text' as const, value: 'ok' },
  });

  /** The ids one step's parts of `type` carry, in part order. */
  function idsOf(
    message: ModelMessage | undefined,
    type: 'tool-call' | 'tool-result',
  ): Array<string> {
    const content = message?.content;

    if (!Array.isArray(content)) throw new Error('the step carries no parts');

    const found: Array<string> = [];

    for (const part of content) {
      if (part.type === type) found.push(part.toolCallId);
    }

    return found;
  }

  it('moves a live id the request already used, and its result with it', () => {
    const ids = createToolCallIdMap();

    // A part earlier in the request already sent this id.
    ids.resolve('call_0', true);

    const [step, results] = normalizeStepToolCallIds(
      [
        { role: 'assistant', content: [callPart('call_0')] },
        { role: 'tool', content: [resultPart('call_0')] },
      ],
      ids,
    );

    const [callId] = idsOf(step, 'tool-call');

    expect(callId).not.toBe('call_0');
    expect(callId).toMatch(WIRE_TOOL_CALL_ID);
    expect(idsOf(results, 'tool-result')).toEqual([callId]);
  });

  it('keeps two per-response repeats in one step distinct, paired by occurrence', () => {
    const [step, results] = normalizeStepToolCallIds(
      [
        {
          role: 'assistant',
          content: [callPart('call_0'), callPart('call_0')],
        },
        {
          role: 'tool',
          content: [resultPart('call_0'), resultPart('call_0')],
        },
      ],
      createToolCallIdMap(),
    );

    const callIds = idsOf(step, 'tool-call');

    expect(callIds[0]).toBe('call_0');
    expect(callIds[1]).not.toBe('call_0');
    expect(idsOf(results, 'tool-result')).toEqual(callIds);
  });
});
