/**
 * The Continue Run's kept-part records (turn-actions D5/D11): the state its
 * event log starts from, the step numbers admission stamps, and the request
 * the shared projection builds from the kept parts. Grouping and rendering
 * themselves belong to `context-builder.test.ts`; these cases pin what a
 * Continue Run contributes to them.
 */

import type { ModelMessage } from 'ai';

import { isNumber, isRecord } from '@workspace/runtime-safety';

import { continuedMediaKey } from '../media/retained-media';
import { type MessagePart, projectStoredReplyParts } from './context-builder';
import {
  continueStateFromEvents,
  continuedCallSteps,
  continueStepOffset,
  ownSnapshotParts,
  withKeptSteps,
  type ContinuedEvent,
} from './continue-projection';

const CALL_ID = 'call-1';
const CALL_ID_2 = 'call-2';

function toolPart(toolCallId: string, output: string): MessagePart {
  return {
    type: 'tool-read',
    toolCallId,
    state: 'output-available',
    input: { path: `/work/${toolCallId}` },
    output: { status: 'success', text: output },
    outcome: 'success',
  };
}

function requestEvent(toolCallId: string, stepNumber: number): ContinuedEvent {
  return {
    eventType: 'tool.requested',
    payload: { toolCallId, stepNumber },
  };
}

/** The step a stored part records, when it records one. */
function stepOf(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- the stored part union is jsonb; `isRecord` narrows it here.
  part: unknown,
): number | undefined {
  return isRecord(part) && isNumber(part['step']) ? part['step'] : undefined;
}

/** A kept part as the projection reads it after admission stamped it. */
function keptPart(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- admission returns the stored parts with a step added; the cases read them as parts.
  part: unknown,
): MessagePart {
  // SAFETY: the kept parts are the reply's stored UI parts; admission only
  // adds the step numbers these cases assert on.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return part as MessagePart;
}

function project(parts: ReadonlyArray<unknown>): Array<ModelMessage> {
  return projectStoredReplyParts(
    parts.map((part) => keptPart(part)),
    { privateParts: true, mediaKey: continuedMediaKey },
  ).messages;
}

describe('the Continue state of a Run', () => {
  const parts: Array<MessagePart> = [
    toolPart(CALL_ID, 'first'),
    toolPart(CALL_ID_2, 'second'),
  ];

  it('stamps the step map an older event holds onto its unnumbered parts', () => {
    // An event written before the parts carried a step records the numbers in
    // its `steps` map; its retired `results` map stays unread.
    expect(
      continueStateFromEvents([
        { eventType: 'run.created', payload: {} },
        {
          eventType: 'run.continued',
          payload: {
            sourceRunId: '0192f3a4-5b6c-7d8e-9f01-000000000000',
            parts,
            steps: { [CALL_ID]: 0, [CALL_ID_2]: 1 },
            results: { [CALL_ID]: { status: 'success' } },
          },
        },
      ]),
    ).toEqual({
      parts: [
        { ...parts[0], step: 0 },
        { ...parts[1], step: 1 },
      ],
    });
  });

  it('keeps the step a stored part records over the legacy map', () => {
    expect(
      continueStateFromEvents([
        {
          eventType: 'run.continued',
          payload: {
            parts: [{ ...toolPart(CALL_ID, 'first'), step: 3 }],
            steps: { [CALL_ID]: 0 },
          },
        },
      ]),
    ).toEqual({ parts: [{ ...toolPart(CALL_ID, 'first'), step: 3 }] });
  });

  it('keeps two back-to-back inherited steps of a master-era Continue apart', () => {
    // Master-era admission stored no step on the parts and numbered the calls
    // it inherited in the event's `steps` map, already offset for the chain.
    // A rebuild or a finalizer after the deploy reads both back from it.
    const state = continueStateFromEvents([
      {
        eventType: 'run.continued',
        payload: {
          parts,
          steps: { [CALL_ID]: 0, [CALL_ID_2]: 1 },
        },
      },
    ]);

    // The Run's own parts start after the two it kept.
    expect(continueStepOffset(state)).toBe(2);
    // No text separates the two calls, so only the numbers keep them apart.
    expect(project(state?.parts ?? []).map(({ role }) => role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'tool',
    ]);
  });

  it('reports no state for a Run that continues nothing', () => {
    expect(
      continueStateFromEvents([{ eventType: 'run.created', payload: {} }]),
    ).toBeUndefined();
    expect(
      continueStateFromEvents([
        { eventType: 'run.continued', payload: { parts: 'nope' } },
      ]),
    ).toBeUndefined();
  });
});

describe('the step numbers a Continue Run adds (design D5)', () => {
  it('starts one step after the highest kept step', () => {
    expect(
      continueStepOffset({
        parts: [
          { ...toolPart(CALL_ID, 'first'), step: 1 },
          toolPart(CALL_ID_2, 'second'),
          { type: 'text', text: 'a', step: 4 },
        ],
      }),
    ).toBe(5);
  });

  it('starts at zero for a Run that keeps no numbered part', () => {
    expect(continueStepOffset(undefined)).toBe(0);
    expect(continueStepOffset({ parts: [toolPart(CALL_ID, 'first')] })).toBe(0);
  });
});

describe('the steps admission derives for the kept calls', () => {
  const parts: Array<MessagePart> = [
    toolPart(CALL_ID, 'first'),
    toolPart(CALL_ID_2, 'second'),
  ];

  it('maps only the kept calls of the source Run events', () => {
    expect(
      continuedCallSteps({
        keptParts: parts,
        sourceEvents: [
          requestEvent(CALL_ID, 0),
          requestEvent('not-kept', 1),
          // A call the source Run made before it recorded step numbers.
          { eventType: 'tool.requested', payload: { toolCallId: CALL_ID_2 } },
        ],
      }),
    ).toEqual({ [CALL_ID]: 0 });
  });

  it('ignores a step recorded on another event type', () => {
    expect(
      continuedCallSteps({
        keptParts: parts,
        sourceEvents: [
          {
            eventType: 'model.delta',
            payload: { toolCallId: CALL_ID, stepNumber: 3 },
          },
        ],
      }),
    ).toEqual({});
  });

  it("renumbers the source Run's own steps after the ones its parts record", () => {
    // The kept parts already record the steps the source Run continued (0 and
    // 1), so they keep them; the step it made itself is numbered from 0 again
    // by its events, and the chain must not merge it with the first kept one.
    expect(
      continuedCallSteps({
        keptParts: [
          { ...toolPart(CALL_ID, 'first'), step: 0 },
          { ...toolPart('call-0', 'second'), step: 1 },
          toolPart(CALL_ID_2, 'third'),
        ],
        sourceEvents: [requestEvent(CALL_ID_2, 0)],
      }),
    ).toEqual({ [CALL_ID_2]: 2 });
  });

  it('keeps the step a kept part already records out of the derived map', () => {
    // The part is the number; stamping it again would only copy it.
    expect(
      continuedCallSteps({
        keptParts: [{ ...toolPart(CALL_ID, 'first'), step: 4 }],
        sourceEvents: [requestEvent(CALL_ID, 0)],
      }),
    ).toEqual({});
  });

  it('numbers a Continue of a master-era Continue after the chain it kept', () => {
    // The source Run continued an earlier one: its own `run.continued` holds
    // the numbers of the two calls it inherited (one step), already offset,
    // and its stored parts carry none. The Continue of it keeps those numbers
    // and puts its own call after them.
    const inherited = [
      toolPart(CALL_ID, 'first'),
      toolPart(CALL_ID_2, 'second'),
    ];
    const sourceContinued = continueStateFromEvents([
      {
        eventType: 'run.continued',
        payload: { parts: inherited, steps: { [CALL_ID]: 0, [CALL_ID_2]: 0 } },
      },
    ]);
    const sourceParts: Array<MessagePart> = [
      ...inherited,
      toolPart('call-own', 'own'),
    ];

    const steps = continuedCallSteps({
      keptParts: sourceParts,
      sourceContinued,
      sourceEvents: [requestEvent('call-own', 0)],
    });

    expect(steps).toEqual({
      [CALL_ID]: 0,
      [CALL_ID_2]: 0,
      'call-own': 1,
    });
    expect(withKeptSteps(sourceParts, steps).map(stepOf)).toEqual([0, 0, 1]);
  });
});

describe('the step numbers admission stamps on the kept parts', () => {
  const reasoning: MessagePart = { type: 'reasoning', text: 'plan' };
  const text: MessagePart = { type: 'text', text: 'reading' };

  it("copies a kept call's step from the source Run's recorded event", () => {
    const original = toolPart(CALL_ID, 'first');

    const stamped = withKeptSteps([original], { [CALL_ID]: 0 });

    expect(stamped).toEqual([{ ...original, step: 0 }]);
    // The stored source is never mutated.
    expect(original).not.toHaveProperty('step');
  });

  it('numbers the text and reasoning before a kept call with its step', () => {
    const parts = [reasoning, text, toolPart(CALL_ID, 'first')];

    const stamped = withKeptSteps(parts, { [CALL_ID]: 3 });

    // The live step sent one assistant message with all three, so the kept
    // parts must carry the same number.
    expect(stamped.map((part) => stepOf(part))).toEqual([3, 3, 3]);
  });

  it('keeps text between calls of one step in that step', () => {
    const between: MessagePart = { type: 'text', text: 'between' };
    const parts = [
      toolPart(CALL_ID, 'first'),
      between,
      toolPart(CALL_ID_2, 'second'),
    ];

    const stamped = withKeptSteps(parts, {
      [CALL_ID]: 0,
      [CALL_ID_2]: 0,
    });

    expect(project(stamped).map(({ role }) => role)).toEqual([
      'assistant',
      'tool',
    ]);
    expect(project(stamped)[0]?.content).toEqual([
      expect.objectContaining({ toolCallId: CALL_ID }),
      { type: 'text', text: 'between' },
      expect.objectContaining({ toolCallId: CALL_ID_2 }),
    ]);
  });

  it('numbers text after a step with the next step it leads into', () => {
    const parts = [
      toolPart(CALL_ID, 'first'),
      { type: 'text', text: 'then' },
      toolPart(CALL_ID_2, 'second'),
    ];

    const stamped = withKeptSteps(parts, {
      [CALL_ID]: 0,
      [CALL_ID_2]: 1,
    });

    // The consecutive rule places text after a step's calls at the start of
    // the next step; one number per part keeps it there.
    expect(stamped.map((part) => stepOf(part))).toEqual([0, 1, 1]);
  });

  it('keeps an existing step and adds none to a part no record numbers', () => {
    const numbered: MessagePart = { ...toolPart(CALL_ID, 'first'), step: 2 };
    const unrecorded = toolPart(CALL_ID_2, 'second');

    expect(
      withKeptSteps([numbered, unrecorded], { [CALL_ID]: 0, [CALL_ID_2]: 5 }),
    ).toEqual([numbered, { ...unrecorded, step: 5 }]);
    expect(withKeptSteps([unrecorded], {})).toEqual([unrecorded]);
  });

  it('stops a step number at an unnumbered call instead of reaching across it', () => {
    // The reply kept two parallel calls its own parts never numbered, then a
    // text and a call admission numbered. The number of the later call must
    // not pull the reasoning and text at the front away from the calls they
    // led into: those stay in the consecutive rule's step, and the numbered
    // text leads into the numbered call.
    const parts = [
      reasoning,
      text,
      toolPart(CALL_ID, 'first'),
      toolPart(CALL_ID_2, 'second'),
      { type: 'text', text: 'then' },
      toolPart('call-later', 'later'),
    ];

    const stamped = withKeptSteps(parts, { 'call-later': 0 });

    expect(stamped.map(stepOf)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      0,
      0,
    ]);
    // The live step sent the reasoning, the text, and both parallel calls as
    // one assistant message; they stay one.
    const messages = project(stamped);
    expect(messages.map(({ role }) => role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'tool',
    ]);
    expect(messages[0]?.content).toEqual([
      { type: 'reasoning', text: 'plan' },
      { type: 'text', text: 'reading' },
      expect.objectContaining({ toolCallId: CALL_ID }),
      expect.objectContaining({ toolCallId: CALL_ID_2 }),
    ]);
    expect(messages[2]?.content).toEqual([
      { type: 'text', text: 'then' },
      expect.objectContaining({ toolCallId: 'call-later' }),
    ]);
  });

  it('keeps an unnumbered call beside the numbered call it was sent with', () => {
    // One response sent the reasoning and both calls; only the first call's
    // number was recorded. Both calls stay in one assistant message with the
    // reasoning before them, so a thinking-enabled provider still sees the
    // signed reasoning ahead of the calls it covers.
    const parts = [
      reasoning,
      toolPart(CALL_ID, 'first'),
      toolPart(CALL_ID_2, 'second'),
    ];

    const messages = project(withKeptSteps(parts, { [CALL_ID]: 0 }));

    expect(messages.map(({ role }) => role)).toEqual(['assistant', 'tool']);
    expect(messages[0]?.content).toEqual([
      { type: 'reasoning', text: 'plan' },
      expect.objectContaining({ toolCallId: CALL_ID }),
      expect.objectContaining({ toolCallId: CALL_ID_2 }),
    ]);
    expect(messages[1]).toMatchObject({
      role: 'tool',
      content: [
        expect.objectContaining({ toolCallId: CALL_ID }),
        expect.objectContaining({ toolCallId: CALL_ID_2 }),
      ],
    });
  });

  it('groups a mixed numbered and unnumbered reply like the live step', () => {
    // A source Run recorded before parts recorded a step: admission stamps
    // its calls and their text, then the Continue Run's own parts follow. The
    // kept step and the new one stay separate.
    const sourceParts = [reasoning, text, toolPart(CALL_ID, 'first')];
    const steps = continuedCallSteps({
      keptParts: sourceParts,
      sourceEvents: [requestEvent(CALL_ID, 0)],
    });
    const kept = withKeptSteps(sourceParts, steps);
    const reply = [...kept, { type: 'text', text: 'done', step: 1 }];

    const messages = project(reply);

    expect(messages.map(({ role }) => role)).toEqual([
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(messages[0]?.content).toEqual([
      { type: 'reasoning', text: 'plan' },
      { type: 'text', text: 'reading' },
      expect.objectContaining({ toolCallId: CALL_ID }),
    ]);
    expect(messages[2]?.content).toEqual([{ type: 'text', text: 'done' }]);
  });

  it('sends kept results of more than 100,000 characters in full', () => {
    const long = 'x'.repeat(60_000);

    const lines = project([
      { ...toolPart(CALL_ID, long), step: 0 },
      { ...toolPart(CALL_ID_2, long), step: 0 },
    ]);

    const serialized = JSON.stringify(lines);
    expect(serialized.match(/x{60000}/gu)).toHaveLength(2);
    expect(serialized).not.toContain('omitted');
  });

  it('replays a kept reasoning part and its metadata on the same model', () => {
    const metadata = { openai: { itemId: 'rs-1', encryptedContent: 'ENC' } };
    const lines = project([
      {
        type: 'reasoning',
        text: 'thinking',
        providerMetadata: metadata,
        step: 0,
      },
      {
        type: 'text',
        text: 'reading',
        providerMetadata: { openai: { itemId: 't-1' } },
        step: 0,
      },
      { ...toolPart(CALL_ID, 'first'), step: 0 },
    ]);

    // Only the model check applies to a kept part, even though the source Run
    // failed: the parts are the same turn (design D7).
    expect(lines[0]?.content).toEqual([
      { type: 'reasoning', text: 'thinking', providerOptions: metadata },
      {
        type: 'text',
        text: 'reading',
        providerOptions: { openai: { itemId: 't-1' } },
      },
      expect.objectContaining({ toolCallId: CALL_ID }),
    ]);
  });
});

describe('the snapshot parts a Continue rebuild owns', () => {
  it("keeps every non-item part and only this Run's items", () => {
    const ownRunId = '0192f3a4-5b6c-7d8e-9f01-00000000000a';
    const ownItem = {
      type: 'data-context',
      data: {
        v: 1,
        producer: 'instructions',
        runId: ownRunId,
        payload: {},
        text: 'own',
      },
    };
    const keptItem = {
      type: 'data-context',
      data: {
        v: 1,
        producer: 'instructions',
        runId: '0192f3a4-5b6c-7d8e-9f01-00000000000b',
        payload: {},
        text: 'kept',
      },
    };
    const text: MessagePart = { type: 'text', text: 'half' };

    expect(ownSnapshotParts([text, keptItem, ownItem], ownRunId)).toEqual([
      text,
      ownItem,
    ]);
  });
});
