/**
 * The Continue boundary (turn-actions D4): which parts of an unfinished reply
 * a Continue Run keeps. The stored shape is what the reply holds, so these
 * parts are built from the same producers a live Run uses.
 */

import { createContextItemPart } from './context-item';
import { continueKeptParts, isSettledToolPart } from './continue-kept-parts';

const runId = '11111111-1111-4111-8111-111111111111';

function text(value: string) {
  return { type: 'text', text: value };
}

function reasoning(value: string) {
  return { type: 'reasoning', text: value };
}

function call(toolCallId: string, state: string, toolName = 'read') {
  return {
    type: `tool-${toolName}`,
    toolCallId,
    state,
    input: { path: `/tmp/${toolCallId}` },
    ...(state === 'output-available' && { output: { ok: toolCallId } }),
    ...(state === 'output-error' && { errorText: `failed ${toolCallId}` }),
  };
}

function contextItem(producer: 'tool-availability' | 'temporal') {
  return createContextItemPart({
    producer,
    runId,
    payload: {},
    text: `<system-reminder>${producer}</system-reminder>`,
  });
}

describe('continueKeptParts', () => {
  it('keeps three settled steps and drops the unfinished step', () => {
    const parts = [
      reasoning('step 1 reasoning'),
      text('step 1 text'),
      call('call-1', 'output-available'),
      reasoning('step 2 reasoning'),
      text('step 2 text'),
      call('call-2', 'output-error'),
      reasoning('step 3 reasoning'),
      text('step 3 text'),
      call('call-3', 'output-available'),
      // The unfinished step: its partial text and reasoning have no settled
      // call after them, so every one of them is dropped.
      text('partial answer'),
      reasoning('partial reasoning'),
      call('call-4', 'input-available'),
    ];

    expect(continueKeptParts(parts)).toEqual(parts.slice(0, 9));
  });

  it('keeps nothing when no tool part settled', () => {
    expect(
      continueKeptParts([
        reasoning('thought'),
        text('partial answer'),
        call('call-1', 'input-available'),
      ]),
    ).toEqual([]);
    expect(continueKeptParts([])).toEqual([]);
  });

  it('keeps the context items directly after the last settled result', () => {
    const availability = contextItem('tool-availability');
    const temporal = contextItem('temporal');
    const parts = [
      text('step 1 text'),
      call('call-1', 'output-available'),
      availability,
      temporal,
      // After the items, the unfinished step begins.
      text('partial answer'),
    ];

    expect(continueKeptParts(parts)).toEqual([
      text('step 1 text'),
      call('call-1', 'output-available'),
      availability,
      temporal,
    ]);
  });

  it('keeps nothing when the reply opens with context items but never settles a call', () => {
    // The in-Run items a producer writes before the first step are not a
    // completed step: with no settled call there is nothing to continue from.
    const parts = [
      contextItem('temporal'),
      contextItem('tool-availability'),
      text('partial answer'),
      call('call-1', 'input-available'),
    ];

    expect(continueKeptParts(parts)).toEqual([]);
  });

  it('keeps a context item between two steps with the step it follows', () => {
    const availability = contextItem('tool-availability');
    const parts = [
      call('call-1', 'output-available'),
      availability,
      text('step 2 text'),
      call('call-2', 'output-available'),
    ];

    expect(continueKeptParts(parts)).toEqual(parts);
  });
});

describe('isSettledToolPart', () => {
  it('accepts only tool parts that hold a result', () => {
    expect(isSettledToolPart(call('call-1', 'output-available'))).toBe(true);
    expect(isSettledToolPart(call('call-1', 'output-error'))).toBe(true);
    expect(isSettledToolPart(call('call-1', 'input-available'))).toBe(false);
    expect(isSettledToolPart(text('not a tool part'))).toBe(false);
    expect(isSettledToolPart(contextItem('temporal'))).toBe(false);
    expect(isSettledToolPart(null)).toBe(false);
  });
});
