import {
  createAssistantPartCollector,
  reconstructDurableAssistant,
  toolActivityPart,
  type ToolActivityPart,
} from './assistant-transcript';
import { asDouble } from '../testing/support';
import { createContextItemPart } from '../chats/context-item';
import { type MessagePart } from '../chats/context-builder';
import { projectStoredToolPart } from '../chats/tool-observation-part';

/** The later-turn projection of one assistant row's tool parts. */
const project = (parts: ReadonlyArray<MessagePart>) =>
  parts.flatMap((part, partIndex) => {
    const stored = projectStoredToolPart(part, `msg-1:${partIndex}`);
    return stored === undefined ? [] : [stored];
  });
import {
  REJECTED_HOP_MESSAGE,
  REJECTED_URL_BOUND,
  rejectedHopUrl,
} from '../tools/permissions/messages';
import type { RunEvent } from '../db/schema';
import type { ToolResult } from '../tools/types';
import type { DerivedDecisionRecord } from '../tools/web-read/admission';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const timestamp = new Date('2026-09-02T12:00:00.000Z');

// eslint-disable-next-line anti-slop/no-unknown-parameters -- test fixture intentionally feeds malformed and valid persisted payload shapes through the replay boundary.
function event(eventType: string, payload: unknown): RunEvent {
  return {
    sequence: 1,
    runId: RUN_ID,
    eventType,
    payload,
    createdAt: timestamp,
  };
}

type StoredPermissionRecord = {
  readonly policyId: string;
  readonly decision: string;
  readonly reason: string;
  readonly reference: unknown;
};

function reconstructStoredPermission(permission: StoredPermissionRecord) {
  return reconstructDurableAssistant([
    event('tool.requested', {
      toolCallId: 'stored-permission',
      toolName: 'search',
      input: { query: 'needle' },
      permission,
    }),
    event('tool.completed', {
      toolCallId: 'stored-permission',
      output: { status: 'success', value: 'ok' },
    }),
  ]).collector.parts();
}

function successToolPart(toolCallId: string): ToolActivityPart {
  return {
    type: 'tool-search',
    toolCallId,
    state: 'output-available',
    input: { query: 'needle' },
    output: { status: 'success', value: 'found' },
    outcome: 'success',
    classification: null,
  };
}

function errorToolPart(
  toolCallId: string,
  errorText = 'failed',
  outcome = 'error',
): ToolActivityPart {
  return {
    type: 'tool-search',
    toolCallId,
    state: 'output-error',
    input: { query: 'needle' },
    errorText,
    outcome,
    classification: null,
  };
}

describe('AssistantPartCollector', () => {
  it('ignores empty fragments and merges adjacent text/reasoning fragments', () => {
    const collector = createAssistantPartCollector();

    collector.text('');
    collector.text('hello ');
    collector.text('world');
    collector.reasoning('');
    collector.reasoning('think ');
    collector.reasoning('more');

    expect(collector.parts()).toEqual([
      { type: 'text', text: 'hello world' },
      { type: 'reasoning', text: 'think more' },
    ]);
  });

  it('starts a new text part when the adapter part id changes', () => {
    const collector = createAssistantPartCollector();

    // Same id: one part. Different defined ids: the second message item is a
    // part of its own (design A7).
    collector.text('first ', '0:msg_1');
    collector.text('message', '0:msg_1');
    collector.text('second ', '0:msg_2');
    collector.text('message', '0:msg_2');

    expect(collector.parts()).toStrictEqual([
      { type: 'text', text: 'first message' },
      { type: 'text', text: 'second message' },
    ]);
  });

  it('starts a new text part when the step changes under one adapter id', () => {
    const collector = createAssistantPartCollector();

    // Chat Completions sends `txt-0` on every step, so the id alone cannot
    // delimit a part: each step's text stays in its own part (design D5).
    collector.text('step one', 'txt-0', undefined, 0);
    collector.text('step two', 'txt-0', undefined, 1);

    expect(collector.parts()).toStrictEqual([
      { type: 'text', text: 'step one', step: 0 },
      { type: 'text', text: 'step two', step: 1 },
    ]);
  });

  it('starts a new reasoning part when the step changes under one adapter id', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('step one', 'reasoning-0', undefined, 0);
    collector.reasoning('step two', 'reasoning-0', undefined, 1);

    expect(collector.parts()).toStrictEqual([
      { type: 'reasoning', text: 'step one', step: 0 },
      { type: 'reasoning', text: 'step two', step: 1 },
    ]);
  });

  it('stamps a metadata-only reasoning start with the step it arrived in', () => {
    const collector = createAssistantPartCollector();
    const metadata = { openai: { itemId: 'rs_1' } };

    collector.reasoning('step one', 'rs-0', undefined, 0);
    collector.reasoning('', 'rs-1', metadata, 1);

    expect(collector.parts()).toStrictEqual([
      { type: 'reasoning', text: 'step one', step: 0 },
      { type: 'reasoning', text: '', providerMetadata: metadata, step: 1 },
    ]);
  });

  it('holds a text part’s start metadata until its id produces text', () => {
    const collector = createAssistantPartCollector();
    const start = { openai: { itemId: 'msg_1' } };
    const end = { openai: { itemId: 'msg_1', annotations: [] } };

    // The Responses start arrives before any character, and it must not
    // create an empty part (design A7).
    collector.text('', '0:msg_1', start);
    expect(collector.parts()).toStrictEqual([]);

    collector.text('hello', '0:msg_1');
    expect(collector.parts()).toStrictEqual([
      { type: 'text', text: 'hello', providerMetadata: start },
    ]);

    // The end repeats the item id with its full metadata and binds to the
    // same part; an empty delivery with no metadata adds nothing.
    collector.text('', '0:msg_1', end);
    collector.text('', '0:msg_2');
    expect(collector.parts()).toStrictEqual([
      { type: 'text', text: 'hello', providerMetadata: end },
    ]);
  });

  it('starts no text part for metadata under an id that never writes text', () => {
    const collector = createAssistantPartCollector();
    const metadata = { openai: { itemId: 'msg_2' } };

    collector.text('the answer', '0:msg_1');
    collector.text('');
    collector.text('', '0:msg_2', metadata);

    // The second item produced no visible text, so it has nothing to replay
    // and no empty part may appear.
    expect(collector.parts()).toStrictEqual([
      { type: 'text', text: 'the answer' },
    ]);
  });

  it('binds text metadata without an id to the open text part', () => {
    const collector = createAssistantPartCollector();
    const metadata = { openai: { itemId: 'msg_1' } };

    collector.text('plain answer');
    collector.text('', undefined, metadata);

    expect(collector.parts()).toStrictEqual([
      { type: 'text', text: 'plain answer', providerMetadata: metadata },
    ]);
  });

  it('stores opaque provider metadata on the part its adapter id names', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('first summary', 'rs_1:0');
    collector.reasoning('second summary', 'rs_1:1');
    // The Responses adapter ends an earlier summary of the same reasoning
    // item when the next one opens, so both ends can arrive after the later
    // part already collected text; the id decides the target part.
    collector.reasoning('', 'rs_1:0', { openai: { itemId: 'rs_1' } });
    collector.reasoning('', 'rs_1:1', {
      openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' },
    });

    expect(collector.parts()).toEqual([
      {
        type: 'reasoning',
        text: 'first summary',
        providerMetadata: { openai: { itemId: 'rs_1' } },
      },
      {
        type: 'reasoning',
        text: 'second summary',
        providerMetadata: {
          openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' },
        },
      },
    ]);
  });

  it('binds metadata without a part id to the open reasoning part', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('wire without ids');
    collector.reasoning('', undefined, { openai: { itemId: 'rs_1' } });

    expect(collector.parts()).toEqual([
      {
        type: 'reasoning',
        text: 'wire without ids',
        providerMetadata: { openai: { itemId: 'rs_1' } },
      },
    ]);
  });

  it('leaves a reasoning part without metadata exactly as it was', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('plain thinking', 'reasoning-0');
    // An empty delivery with no metadata says nothing and adds no part.
    collector.reasoning('', 'reasoning-0');

    // `toStrictEqual` (not `toEqual`): an explicit `providerMetadata:
    // undefined` key would fail here, and the shape must be unchanged.
    expect(collector.parts()).toStrictEqual([
      { type: 'reasoning', text: 'plain thinking' },
    ]);
  });

  it('starts an empty part for a metadata-only delivery under an id nothing carries (D18)', () => {
    const collector = createAssistantPartCollector();
    const redacted = { anthropic: { redactedData: 'REDACTED_BLOCK' } };
    const signature = { anthropic: { signature: 'SIG_WITHHELD' } };

    // A redacted block: its payload rides the start, and no text exists. A
    // withheld block is the same shape one delivery later — an empty delta
    // carrying the signature. Both are blocks a later request must replay,
    // so each persists as its own empty part, in order.
    collector.reasoning('', '0:0', redacted);
    collector.reasoning('', '0:1', signature);

    expect(collector.parts()).toStrictEqual([
      { type: 'reasoning', text: '', providerMetadata: redacted },
      { type: 'reasoning', text: '', providerMetadata: signature },
    ]);

    // The empty part is the open one: text the wire still sends under that id
    // lands in it rather than opening another part.
    collector.reasoning(' after the fact', '0:1');
    expect(collector.parts()).toStrictEqual([
      { type: 'reasoning', text: '', providerMetadata: redacted },
      {
        type: 'reasoning',
        text: ' after the fact',
        providerMetadata: signature,
      },
    ]);
  });

  it('starts no part for an empty delivery that carries no provider metadata (D18)', () => {
    const collector = createAssistantPartCollector();
    const signature = { anthropic: { signature: 'SIG_WITHHELD' } };

    collector.reasoning('visible thinking', 'reasoning-0');
    // No text and no metadata: the delivery says nothing at all, so an id no
    // collected part carries must not open an empty part — a block exists to
    // persist only once its metadata arrives (design D18).
    collector.reasoning('', 'reasoning-1');

    expect(collector.parts()).toStrictEqual([
      { type: 'reasoning', text: 'visible thinking' },
    ]);

    // The metadata under that same id is what starts the part, behind the
    // text that already preceded it.
    collector.reasoning('', 'reasoning-1', signature);
    expect(collector.parts()).toStrictEqual([
      { type: 'reasoning', text: 'visible thinking' },
      { type: 'reasoning', text: '', providerMetadata: signature },
    ]);
  });

  it('filters unresolved requests but preserves an unrequested settlement', () => {
    const collector = createAssistantPartCollector();

    collector.toolRequested('pending');
    collector.tool(successToolPart('unrequested'));

    expect(collector.parts()).toEqual([successToolPart('unrequested')]);
  });

  it('keeps the first settlement and removes the pending index after replacement', () => {
    const collector = createAssistantPartCollector();
    const first = errorToolPart('call-1', 'cancelled', 'cancelled');

    collector.toolRequested('call-1');
    collector.tool(first);
    collector.tool(successToolPart('call-1'));

    expect(collector.parts()).toEqual([first]);
  });

  it('persists every reasoning part whole past the former persistence cap', () => {
    const collector = createAssistantPartCollector();
    // Both parts individually exceed the deleted 24,000-character cap.
    const first = 'x'.repeat(30_000);
    const second = 'y'.repeat(30_000);

    collector.reasoning(first, 'rs_1:0');
    collector.reasoning(second, 'rs_1:1');

    const parts = collector.parts();
    expect(parts).toEqual([
      { type: 'reasoning', text: first },
      { type: 'reasoning', text: second },
    ]);
    // No truncation marker: the persisted text is the text the provider
    // produced, byte for byte (D9/D11 — replay signs or encrypts it).
    expect(JSON.stringify(parts)).not.toContain('…');
  });
});

function contextItemPart() {
  return createContextItemPart({
    producer: 'workspace',
    form: 'notice',
    runId: RUN_ID,
    payload: {},
    text: '<system-reminder producer="workspace" form="notice">x</system-reminder>',
  });
}

describe('AssistantPartCollector in-Run context items (D1)', () => {
  it('stores an item staged between steps after the tool parts it followed', () => {
    const collector = createAssistantPartCollector();
    collector.toolRequested('c1');
    collector.tool(successToolPart('c1'));
    collector.toolRequested('c2');
    collector.tool(errorToolPart('c2'));
    const item = contextItemPart();
    collector.contextItem(item);

    expect(collector.parts()).toEqual([
      successToolPart('c1'),
      errorToolPart('c2'),
      item,
    ]);
  });

  it('holds an item after a tool slot that is still reserved', () => {
    const collector = createAssistantPartCollector();
    collector.toolRequested('c1');
    const item = contextItemPart();
    collector.contextItem(item);

    collector.tool(successToolPart('c1'));

    // The settlement fills the reserved slot in place, so the item keeps its
    // position after the tool part the step's results triggered.
    expect(collector.parts()).toEqual([successToolPart('c1'), item]);
  });
});

describe('AssistantPartCollector seeding (Continue runs)', () => {
  it('starts the transcript from the kept parts, in order', () => {
    const collector = createAssistantPartCollector();

    collector.seed([
      { type: 'reasoning', text: 'kept thinking' },
      { type: 'text', text: 'kept answer' },
      successToolPart('c1'),
    ]);
    collector.text('new answer');

    expect(collector.parts()).toEqual([
      { type: 'reasoning', text: 'kept thinking' },
      { type: 'text', text: 'kept answer' },
      successToolPart('c1'),
      { type: 'text', text: 'new answer' },
    ]);
  });

  it('counts a seeded call as settled, so a late settlement cannot replace it', () => {
    const collector = createAssistantPartCollector();
    const kept = successToolPart('c1');
    collector.seed([kept]);

    collector.tool({ ...successToolPart('c1'), output: { late: true } });

    expect(collector.parts()).toEqual([kept]);
  });

  it('ignores a seeded entry that is not a message part', () => {
    const collector = createAssistantPartCollector();

    // Stored jsonb is untrusted; a malformed entry contributes nothing and
    // does not stop the rest of the seed.
    // The seed receives the reply's stored jsonb, which a malformed writer can
    // leave holding anything; these values are that shape.
    const malformed = [
      null,
      'not a part',
      { type: 'text', text: 'kept answer' },
    ];
    collector.seed(asDouble<ReadonlyArray<MessagePart>>(malformed));

    expect(collector.parts()).toEqual([{ type: 'text', text: 'kept answer' }]);
  });
});

describe('toolActivityPart', () => {
  it('shapes successful tool results without adding error metadata', () => {
    const result: ToolResult = { status: 'success', value: 'ok' };

    expect(
      toolActivityPart({
        toolCallId: 'call-1',
        toolName: 'search',
        input: { query: 'q' },
        result,
        classification: 'read_only',
      }),
    ).toEqual({
      type: 'tool-search',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { query: 'q' },
      output: result,
      outcome: 'success',
      classification: 'read_only',
    });
    // No decision was made, so the part carries no `permission` key at all —
    // not even one holding `undefined`.
    expect(
      Object.keys(
        toolActivityPart({
          toolCallId: 'call-1',
          toolName: 'search',
          input: { query: 'q' },
          result,
          classification: 'read_only',
        }),
      ),
    ).not.toContain('permission');
  });

  it('stores a refused call’s step and the SDK’s own form of it', () => {
    const sdkErrorText =
      'Invalid input for tool read: Type validation failed. Received: {"path":3}';
    const part = toolActivityPart({
      toolCallId: 'call-1',
      toolName: 'read',
      input: { path: 3 },
      result: {
        status: 'error',
        type: 'invalid_input',
        message: 'Invalid input for the read tool.',
      },
      step: 1,
      sdkRefusal: { errorText: sdkErrorText, input: { path: 3 } },
    });

    expect(part).toMatchObject({
      toolCallId: 'call-1',
      state: 'output-error',
      // The owner-facing error stays llame's own message; the SDK's text lives
      // beside it for the model only (design D3, proposal A8).
      errorText: 'Invalid input for the read tool.',
      outcome: 'invalid_input',
      step: 1,
      sdkRefusal: { errorText: sdkErrorText, input: { path: 3 } },
    });
  });

  it('copies a well-formed artifact locator beside the result', () => {
    const part = toolActivityPart({
      toolCallId: 'call-1',
      toolName: 'grep',
      input: { pattern: 'q' },
      result: {
        status: 'success',
        content: '## src/a.ts',
        artifact: 'artifact://grep-7',
      },
    });

    expect(part.artifact).toBe('artifact://grep-7');
  });

  it('copies an artifact locator from an error result', () => {
    const part = toolActivityPart({
      toolCallId: 'call-1',
      toolName: 'bash',
      input: { command: 'build' },
      result: {
        status: 'error',
        type: 'command_failed',
        message: 'exit 1',
        artifact: 'artifact://bash-4/stderr',
      },
    });

    expect(part).toMatchObject({
      state: 'output-error',
      errorText: 'exit 1',
      artifact: 'artifact://bash-4/stderr',
    });
  });

  it('copies a well-formed locator and stores none for a malformed one', () => {
    const wellFormed = toolActivityPart({
      toolCallId: 'call-1',
      toolName: 'grep',
      input: { pattern: 'q' },
      result: {
        status: 'success',
        content: 'answer',
        artifact: 'artifact://grep-7',
      },
    });
    expect(wellFormed.artifact).toBe('artifact://grep-7');

    const malformed: ToolResult = {
      status: 'success',
      content: 'answer',
      artifact: 'artifact://grep-7:1-20',
    };
    expect(
      Object.hasOwn(
        toolActivityPart({
          toolCallId: 'call-1',
          toolName: 'grep',
          input: { pattern: 'q' },
          result: malformed,
        }),
        'artifact',
      ),
    ).toBe(false);
  });

  it('stores a web search success as its normalized output, not its text', () => {
    const result: ToolResult = {
      status: 'success',
      kind: 'results',
      engine: 'brave',
      query: 'deployment decision',
      results: [
        { title: 'Example', url: 'https://example.com/docs', snippet: 'S.' },
      ],
    };
    const part = toolActivityPart({
      toolCallId: 'call-web',
      toolName: 'web_search',
      input: { query: 'deployment decision' },
      result,
      classification: 'read_only',
    });

    // The stored part is what the web chat renderer reads after a reload, so
    // the model-facing text shape of another layer cannot replace it
    // (web-search "Reload reproduces the output").
    expect(part).toEqual({
      type: 'tool-web_search',
      toolCallId: 'call-web',
      state: 'output-available',
      input: { query: 'deployment decision' },
      output: result,
      outcome: 'success',
      classification: 'read_only',
    });
  });

  it('omits an empty derived-decision list', () => {
    const part = toolActivityPart({
      toolCallId: 'call-1',
      toolName: 'search',
      input: { query: 'q' },
      result: { status: 'success', value: 'ok' },
      derivedDecisions: [],
      classification: 'read_only',
    });

    expect(part).not.toHaveProperty('derivedDecisions');
  });

  it.each([
    [
      'cancelled',
      { status: 'error', type: 'cancelled', message: 'stopped' },
      'cancelled',
    ],
    [
      'unknown type',
      { status: 'error', type: 'custom', message: 'failed' },
      'custom',
    ],
    ['empty type', { status: 'error', type: '', message: 'failed' }, 'error'],
  ] as const)(
    'shapes %s errors with the normalized outcome',
    (_name, result, outcome) => {
      const part = toolActivityPart({
        toolCallId: 'call-1',
        toolName: 'search',
        input: { query: 'q' },
        result,
        classification: 'read_only',
      });

      expect(part).toMatchObject({
        type: 'tool-search',
        toolCallId: 'call-1',
        state: 'output-error',
        input: { query: 'q' },
        errorText: result.message,
        outcome,
      });
      if (result.type === 'cancelled') {
        expect(part.resultProviderMetadata).toEqual({
          llame: { cancelled: true },
        });
      } else {
        expect(part.resultProviderMetadata).toBeUndefined();
      }
    },
  );

  it('stores the refused target a hop rejection names beside its error', () => {
    const refusedUrl = 'https://blocked.example.test/page';
    const part = toolActivityPart({
      toolCallId: 'call-1',
      toolName: 'read',
      input: { path: 'https://docs.example.test/a' },
      result: {
        status: 'error',
        type: 'permission_denied',
        message: REJECTED_HOP_MESSAGE,
        rejectedUrl: refusedUrl,
      },
      classification: 'read_only',
    });

    expect(part).toEqual({
      type: 'tool-read',
      toolCallId: 'call-1',
      state: 'output-error',
      input: { path: 'https://docs.example.test/a' },
      errorText: REJECTED_HOP_MESSAGE,
      outcome: 'permission_denied',
      errorRejectedUrl: refusedUrl,
      classification: 'read_only',
    });
    // The locator rides beside the fixed message, never inside it.
    expect(part.errorText).not.toContain('blocked.example.test');
  });

  it('stores no refused target for an error that is not a hop rejection', () => {
    const part = toolActivityPart({
      toolCallId: 'call-1',
      toolName: 'search',
      input: { query: 'q' },
      result: {
        status: 'error',
        type: 'network_error',
        message: 'failed',
        rejectedUrl: 'https://blocked.example.test/page',
      },
      classification: 'read_only',
    });

    expect(part).not.toHaveProperty('errorRejectedUrl');
  });

  it('stores no refused target for another tool that reports a permission denial', () => {
    const part = toolActivityPart({
      toolCallId: 'call-1',
      toolName: 'knowledge_search',
      input: { query: 'q' },
      result: {
        status: 'error',
        type: 'permission_denied',
        message: 'rejected',
        rejectedUrl: 'https://blocked.example.test/page',
      },
      classification: 'read_only',
    });

    expect(part).not.toHaveProperty('errorRejectedUrl');
  });
});

describe('reconstructDurableAssistant', () => {
  it('replays text, reasoning, cap notices, and unknown events in event order', () => {
    const result = reconstructDurableAssistant([
      event('model.delta', { text: 'answer ' }),
      event('model.delta', { text: 'text' }),
      event('reasoning.delta', { text: 'think' }),
      event('run.step_cap_reached', { stepsUsed: 4, maxSteps: 4 }),
      event('ignored.event', { text: 'not persisted' }),
      event('model.delta', null),
      event('reasoning.delta', { text: 3 }),
    ]);

    expect(result.collector.parts()).toEqual([
      { type: 'text', text: 'answer text' },
      { type: 'reasoning', text: 'think' },
      { type: 'data-cap-notice', data: { stepsUsed: 4, maxSteps: 4 } },
    ]);
    expect(result.openToolCalls).toEqual(new Map());
  });

  it('rebuilds an error part with its artifact locator', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'c1',
        toolName: 'bash',
        input: { command: 'build' },
      }),
      event('tool.completed', {
        toolCallId: 'c1',
        output: {
          status: 'error',
          type: 'command_failed',
          message: 'exit 1',
          artifact: 'artifact://bash-4/stderr',
        },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      expect.objectContaining({
        type: 'tool-bash',
        toolCallId: 'c1',
        state: 'output-error',
        artifact: 'artifact://bash-4/stderr',
      }),
    ]);
  });

  it('rebuilds a success part with its artifact locator', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'c1',
        toolName: 'grep',
        input: { pattern: 'needle' },
      }),
      event('tool.completed', {
        toolCallId: 'c1',
        output: {
          status: 'success',
          content: '## src/a.ts',
          artifact: 'artifact://grep-1',
        },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      expect.objectContaining({
        type: 'tool-grep',
        artifact: 'artifact://grep-1',
      }),
    ]);
  });

  it('rebuilds text part boundaries and their metadata from the persisted ids', () => {
    const start = { openai: { itemId: 'msg_1' } };
    const end = { openai: { itemId: 'msg_1', annotations: [] } };
    const second = { openai: { itemId: 'msg_2' } };
    const result = reconstructDurableAssistant([
      // The live order of one Responses item: its start's metadata, its
      // text, then its end. A second item is a second part (design A7).
      event('model.delta', { partId: '0:msg_1', providerMetadata: start }),
      event('model.delta', { text: 'first ', partId: '0:msg_1' }),
      event('model.delta', { text: 'message', partId: '0:msg_1' }),
      event('model.delta', { partId: '0:msg_1', providerMetadata: end }),
      event('model.delta', { partId: '0:msg_2', providerMetadata: second }),
      event('model.delta', { text: 'second', partId: '0:msg_2' }),
      // A metadata-only event for an item that wrote nothing must not invent
      // a part.
      event('model.delta', {
        partId: '0:msg_3',
        providerMetadata: { openai: { itemId: 'msg_3' } },
      }),
    ]);

    expect(result.collector.parts()).toStrictEqual([
      { type: 'text', text: 'first message', providerMetadata: end },
      { type: 'text', text: 'second', providerMetadata: second },
    ]);
  });

  it('rebuilds a call’s provider metadata onto its tool part', () => {
    const metadata = { openai: { itemId: 'fc_1' } };
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'c1',
        toolName: 'search',
        input: { query: 'needle' },
        providerMetadata: metadata,
      }),
      event('tool.completed', {
        toolCallId: 'c1',
        output: { status: 'success', value: 'found' },
      }),
      // A malformed payload binds nothing and changes no part.
      event('tool.requested', {
        toolCallId: 'c2',
        toolName: 'search',
        input: { query: 'other' },
        providerMetadata: 'not-a-record',
      }),
      event('tool.completed', {
        toolCallId: 'c2',
        output: { status: 'success', value: 'found' },
      }),
    ]);

    const parts = result.collector.parts();
    expect(parts[0]).toStrictEqual(
      expect.objectContaining({ toolCallId: 'c1', providerMetadata: metadata }),
    );
    expect(parts[1]).not.toHaveProperty('providerMetadata');
  });

  it('drops an artifact value the grammar does not admit', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'c1',
        toolName: 'grep',
        input: { pattern: 'needle' },
      }),
      event('tool.completed', {
        toolCallId: 'c1',
        output: { status: 'success', content: 'x', artifact: 'x' },
      }),
    ]);

    expect(result.collector.parts()[0]).not.toHaveProperty('artifact');
  });

  it('rebuilds reasoning part boundaries from the persisted adapter part ids', () => {
    const result = reconstructDurableAssistant([
      event('reasoning.delta', { text: 'first ', partId: 'rs_1:0' }),
      event('reasoning.delta', { text: 'summary', partId: 'rs_1:0' }),
      event('reasoning.delta', { text: 'second', partId: 'rs_1:1' }),
      event('tool.requested', {
        toolCallId: 'c1',
        toolName: 'search',
        input: { query: 'needle' },
      }),
      event('tool.completed', {
        toolCallId: 'c1',
        output: { status: 'success', value: 'found' },
      }),
      event('reasoning.delta', { text: 'after the tool', partId: 'rs_1:1' }),
      event('model.delta', { text: 'answer' }),
    ]);

    expect(result.collector.parts()).toEqual([
      { type: 'reasoning', text: 'first summary' },
      { type: 'reasoning', text: 'second' },
      expect.objectContaining({ type: 'tool-search', toolCallId: 'c1' }),
      { type: 'reasoning', text: 'after the tool' },
      { type: 'text', text: 'answer' },
    ]);
  });

  it('replays each reasoning part’s provider metadata onto its own part', () => {
    const earlierMetadata = { openai: { itemId: 'rs_1' } };
    const laterMetadata = {
      openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' },
    };
    const result = reconstructDurableAssistant([
      event('reasoning.delta', { text: 'first summary', partId: 'rs_1:0' }),
      event('reasoning.delta', { text: 'second summary', partId: 'rs_1:1' }),
      // The ends arrive after the later part already holds text; the id
      // routes each one to the part it belongs to.
      event('reasoning.delta', {
        partId: 'rs_1:0',
        providerMetadata: earlierMetadata,
      }),
      event('reasoning.delta', {
        partId: 'rs_1:1',
        providerMetadata: laterMetadata,
      }),
      // A malformed payload binds nothing and adds no part.
      event('reasoning.delta', {
        partId: 'rs_1:1',
        providerMetadata: 'not-a-record',
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      {
        type: 'reasoning',
        text: 'first summary',
        providerMetadata: earlierMetadata,
      },
      {
        type: 'reasoning',
        text: 'second summary',
        providerMetadata: laterMetadata,
      },
    ]);
  });

  it('starts an empty part for a metadata-only event whose id the log never carried (D18)', () => {
    const withheld = { anthropic: { signature: 'SIG_WITHHELD' } };
    const result = reconstructDurableAssistant([
      event('model.delta', { text: 'the answer so far' }),
      // A block whose text the provider withheld: the run records its
      // metadata under an id no earlier event carried, so the replay must
      // rebuild the empty part and its bound metadata behind the text.
      event('reasoning.delta', { partId: '0:0', providerMetadata: withheld }),
      // A later delivery naming that part binds to it instead of starting a
      // second one; one carrying no metadata changes nothing.
      event('reasoning.delta', { partId: '0:0' }),
      event('reasoning.delta', { partId: '0:0', providerMetadata: withheld }),
    ]);

    expect(result.collector.parts()).toStrictEqual([
      { type: 'text', text: 'the answer so far' },
      { type: 'reasoning', text: '', providerMetadata: withheld },
    ]);
  });

  it('merges legacy reasoning.delta events that carry no part id', () => {
    const result = reconstructDurableAssistant([
      event('reasoning.delta', { text: 'one ' }),
      event('reasoning.delta', { text: 'thought' }),
      // Absent after a defined id is not a boundary either.
      event('reasoning.delta', { text: ' second', partId: 'rs_1:0' }),
      event('reasoning.delta', { text: ' third' }),
    ]);

    expect(result.collector.parts()).toEqual([
      { type: 'reasoning', text: 'one thought second third' },
    ]);
  });

  it('replays a reasoning part longer than the former cap whole', () => {
    const long = 'z'.repeat(30_000);
    const result = reconstructDurableAssistant([
      event('reasoning.delta', { text: long, partId: 'rs_1:0' }),
    ]);

    const parts = result.collector.parts();
    expect(parts).toEqual([{ type: 'reasoning', text: long }]);
    expect(JSON.stringify(parts)).not.toContain('…');
  });

  it('reserves requested tools, correlates completions, and keeps occurrence order', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'first',
        toolName: 'search',
        input: { query: 'first' },
      }),
      event('tool.requested', {
        toolCallId: 'second',
        toolName: 'lookup',
        input: { query: 'second' },
      }),
      event('tool.completed', {
        toolCallId: 'second',
        output: { status: 'success', value: 'two' },
      }),
      event('tool.completed', {
        toolCallId: 'first',
        output: { status: 'error', type: 'cancelled', message: 'stopped' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      {
        type: 'tool-search',
        toolCallId: 'first',
        state: 'output-error',
        input: { query: 'first' },
        errorText: 'stopped',
        outcome: 'cancelled',
        resultProviderMetadata: { llame: { cancelled: true } },
        classification: null,
      },
      {
        type: 'tool-lookup',
        toolCallId: 'second',
        state: 'output-available',
        input: { query: 'second' },
        output: { status: 'success', value: 'two' },
        outcome: 'success',
        classification: null,
      },
    ]);
    expect(result.openToolCalls).toEqual(new Map());
  });

  it('carries safe permission metadata from request to stored part', () => {
    const permission = {
      policyId: 'policy-1',
      decision: 'reject' as const,
      reason: 'explicit_reject' as const,
      reference: { groupId: 'bash', list: 'reject' as const, clauseIndex: 0 },
    };
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'bash',
        input: { command: 'git push' },
        permission,
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: {
          status: 'error',
          type: 'permission_denied',
          message: 'rejected',
        },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      {
        type: 'tool-bash',
        toolCallId: 'call-1',
        state: 'output-error',
        input: { command: 'git push' },
        errorText: 'rejected',
        outcome: 'permission_denied',
        permission,
        classification: null,
      },
    ]);
  });

  it('ignores malformed permission metadata', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'bash',
        input: {},
        permission: { policyId: 1, decision: 'maybe' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([]);
    expect([...result.openToolCalls.values()][0]?.permission).toBeUndefined();
  });

  it('reconstructs an allow decision from permission mode bypass', () => {
    const permission = {
      policyId: 'policy-bypass',
      decision: 'allow' as const,
      reason: 'permission_mode_bypass' as const,
      reference: null,
    };

    expect(reconstructStoredPermission(permission)).toEqual([
      {
        type: 'tool-search',
        toolCallId: 'stored-permission',
        state: 'output-available',
        input: { query: 'needle' },
        output: { status: 'success', value: 'ok' },
        outcome: 'success',
        permission,
        classification: null,
      },
    ]);
  });

  it('reconstructs an allow decision matched by the policy', () => {
    const permission = {
      policyId: 'policy-matched',
      decision: 'allow' as const,
      reason: 'matched_allow' as const,
      reference: null,
    };

    expect(reconstructStoredPermission(permission)).toEqual([
      {
        type: 'tool-search',
        toolCallId: 'stored-permission',
        state: 'output-available',
        input: { query: 'needle' },
        output: { status: 'success', value: 'ok' },
        outcome: 'success',
        permission,
        classification: null,
      },
    ]);
  });

  it('drops permission mode bypass when it is stored as a rejection', () => {
    const permission = {
      policyId: 'policy-bypass-reject',
      decision: 'reject' as const,
      reason: 'permission_mode_bypass' as const,
      reference: null,
    };

    expect(reconstructStoredPermission(permission)).toEqual([
      {
        type: 'tool-search',
        toolCallId: 'stored-permission',
        state: 'output-available',
        input: { query: 'needle' },
        output: { status: 'success', value: 'ok' },
        outcome: 'success',
        classification: null,
      },
    ]);
  });

  it('keeps a read-only ceiling decision through a private reload', () => {
    const permission = {
      policyId: 'policy-read-only',
      decision: 'reject' as const,
      reason: 'permission_mode_read_only' as const,
      reference: null,
    };
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'bash',
        input: { command: 'git push' },
        permission,
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: {
          status: 'error',
          type: 'permission_denied',
          message: 'rejected',
        },
      }),
    ]);
    const [part] = result.collector.parts();

    // The stored tool part keeps the decision for the owner's reload; model
    // replay, public shares, exports, and search project their own closed
    // shape and receive no decision metadata.
    expect(part).toMatchObject({ permission });
    expect(JSON.stringify(project(result.collector.parts()))).not.toContain(
      'policy-read-only',
    );
  });

  it('drops a stored decision with an unknown reason', () => {
    const permission = {
      policyId: 'policy-unknown',
      decision: 'reject' as const,
      reason: 'future_reason',
      reference: null,
    };

    expect(reconstructStoredPermission(permission)).toEqual([
      {
        type: 'tool-search',
        toolCallId: 'stored-permission',
        state: 'output-available',
        input: { query: 'needle' },
        output: { status: 'success', value: 'ok' },
        outcome: 'success',
        classification: null,
      },
    ]);
  });

  it('reconstructs a stored rejection with a real rejection reason', () => {
    const permission = {
      policyId: 'policy-reject',
      decision: 'reject' as const,
      reason: 'explicit_reject' as const,
      reference: null,
    };

    expect(reconstructStoredPermission(permission)).toEqual([
      {
        type: 'tool-search',
        toolCallId: 'stored-permission',
        state: 'output-available',
        input: { query: 'needle' },
        output: { status: 'success', value: 'ok' },
        outcome: 'success',
        permission,
        classification: null,
      },
    ]);
  });

  it('carries derived-locator decisions from the completion payload to the stored part', () => {
    const permission = {
      policyId: 'policy-1',
      decision: 'allow' as const,
      reason: 'matched_allow' as const,
      reference: { groupId: 'read', list: 'allow' as const, clauseIndex: null },
    };
    const derivedDecisions = [
      { ...permission, kind: 'alternate' as const },
      {
        kind: 'suffix' as const,
        policyId: 'policy-1',
        decision: 'reject' as const,
        reason: 'no_allow' as const,
        reference: { groupId: 'read', list: 'allow' as const, clauseIndex: 0 },
      },
      {
        ...permission,
        kind: 'canonical' as const,
      },
    ];
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'read',
        input: { path: 'https://docs.example.test/a/b' },
        permission,
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success', content: 'body' },
        derivedDecisions,
      }),
    ]);

    // The call decision comes from the request, the derived ones from the
    // completion the executor's decisions settled with.
    expect(result.collector.parts()).toEqual([
      {
        type: 'tool-read',
        toolCallId: 'call-1',
        state: 'output-available',
        input: { path: 'https://docs.example.test/a/b' },
        output: { status: 'success', content: 'body' },
        outcome: 'success',
        permission,
        derivedDecisions,
        classification: null,
      },
    ]);
  });

  it('drops malformed derived-locator decisions and keeps the valid ones', () => {
    const valid = {
      kind: 'hop' as const,
      policyId: 'policy-1',
      decision: 'reject' as const,
      reason: 'no_allow' as const,
      reference: null,
    };
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'read',
        input: {},
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success' },
        derivedDecisions: [
          { policyId: 'policy-1', decision: 'maybe' },
          'not-a-record',
          // A sound decision still needs the kind of locator it judged: an
          // unknown or absent one is dropped rather than guessed at.
          { ...valid, kind: 'redirect' },
          { policyId: 'policy-1', decision: 'allow', reason: 'matched_allow' },
          valid,
        ],
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      expect.objectContaining({ derivedDecisions: [valid] }),
    ]);
  });

  it('reconstructs bypass call and derived decisions while dropping unknown reasons', () => {
    const bypass = {
      policyId: 'process-policy',
      decision: 'allow' as const,
      reason: 'permission_mode_bypass' as const,
      reference: null,
    };
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'read',
        input: { path: 'https://docs.example.test/a' },
        permission: bypass,
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success', content: 'body' },
        derivedDecisions: [
          { ...bypass, kind: 'hop' as const },
          {
            ...bypass,
            kind: 'suffix' as const,
            reason: 'future_reason',
          },
        ],
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      expect.objectContaining({
        permission: bypass,
        derivedDecisions: [{ ...bypass, kind: 'hop' }],
      }),
    ]);
  });

  it.each([
    ['a non-array value', 'not-a-list'],
    ['an empty list', []],
    ['only malformed entries', [{ policyId: 1, decision: 'reject' }]],
  ])('records no derived decisions for %s', (_name, derivedDecisions) => {
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'read',
        input: {},
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success' },
        derivedDecisions,
      }),
    ]);

    expect(result.collector.parts()[0]).not.toHaveProperty('derivedDecisions');
  });

  it('bounds a stored derived-decision list to the per-call budget', () => {
    const decision = {
      kind: 'llms-txt' as const,
      policyId: 'policy-1',
      decision: 'allow' as const,
      reason: 'matched_allow' as const,
      reference: null,
    };
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'read',
        input: {},
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success' },
        derivedDecisions: Array.from({ length: 30 }, () => decision),
      }),
    ]);

    const [part] = result.collector.parts();
    expect(part).toMatchObject({
      derivedDecisions: Array.from({ length: 26 }, () => decision),
    });
  });

  it('bounds stored address decisions separately and drops unknown kinds', () => {
    const addressDecision = {
      kind: 'address' as const,
      policyId: 'policy-address',
      decision: 'reject' as const,
      reason: 'explicit_reject' as const,
      reference: null,
    };
    const hopDecision = {
      kind: 'hop' as const,
      policyId: 'policy-hop',
      decision: 'reject' as const,
      reason: 'no_allow' as const,
      reference: null,
    };
    const stored: Array<unknown> = [];
    for (let index = 0; index < 30; index += 1) {
      stored.push(
        { ...addressDecision, policyId: `address-${index}` },
        { ...hopDecision, policyId: `hop-${index}` },
      );
    }
    stored.splice(1, 0, { ...addressDecision, kind: 'redirect' });
    const expected = [
      ...Array.from({ length: 16 }, (_, index) => [
        { ...addressDecision, policyId: `address-${index}` },
        { ...hopDecision, policyId: `hop-${index}` },
      ]).flat(),
      ...Array.from({ length: 10 }, (_, index) => ({
        ...hopDecision,
        policyId: `hop-${index + 16}`,
      })),
    ];
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'read',
        input: {},
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success' },
        derivedDecisions: stored,
      }),
    ]);

    const toolPart = result.collector
      .parts()
      .find((part): part is ToolActivityPart => part.type === 'tool-read');
    expect(toolPart?.derivedDecisions).toStrictEqual(expected);
    expect(
      toolPart?.derivedDecisions?.filter(({ kind }) => kind === 'address'),
    ).toHaveLength(16);
    expect(
      toolPart?.derivedDecisions?.filter(({ kind }) => kind !== 'address'),
    ).toHaveLength(26);
  });

  it('keeps the refused-file count of a grep-file decision and drops a malformed one', () => {
    const refused = {
      kind: 'grep-file' as const,
      policyId: 'policy-grep',
      decision: 'reject' as const,
      reason: 'explicit_reject' as const,
      reference: null,
    };
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'grep',
        input: { patterns: ['x'] },
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success' },
        derivedDecisions: [
          { ...refused, count: 40 },
          { ...refused, policyId: 'policy-zero', count: 0 },
          { ...refused, policyId: 'policy-bad', count: -1 },
        ],
      }),
    ]);

    const toolPart = result.collector
      .parts()
      .find((part): part is ToolActivityPart => part.type === 'tool-grep');
    expect(toolPart?.derivedDecisions).toStrictEqual([
      { ...refused, count: 40 },
      { ...refused, policyId: 'policy-zero', count: 0 },
      { ...refused, policyId: 'policy-bad' },
    ]);
  });

  it('keeps derived-locator decisions out of the observable result and model replay', () => {
    const decision = {
      kind: 'hop' as const,
      policyId: 'policy-instance-7c1f',
      decision: 'reject' as const,
      reason: 'explicit_reject' as const,
      reference: null,
    };
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'read',
        input: { path: 'https://docs.example.test/a/b' },
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success', content: 'body' },
        derivedDecisions: [decision],
      }),
    ]);
    const [part] = result.collector.parts();

    // The record appears once, in its own field: the observation the model
    // reads, a public share, an export, and search receive carries no policy
    // metadata of its own.
    expect(part).toMatchObject({ derivedDecisions: [decision] });
    expect(JSON.stringify(part).split('policy-instance-7c1f')).toHaveLength(2);
    // Model replay projects its own closed shape from the stored parts.
    expect(JSON.stringify(project(result.collector.parts()))).not.toContain(
      'policy-instance-7c1f',
    );
  });

  it('reloads a refused address decision from durable completion metadata', () => {
    const decision: DerivedDecisionRecord = {
      kind: 'address',
      policyId: 'policy-1',
      decision: 'reject',
      reason: 'explicit_reject',
      reference: { groupId: 'read', list: 'reject', clauseIndex: 0 },
    };
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'read',
        input: { path: 'https://docs.example.test/guide' },
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success', content: 'body' },
        derivedDecisions: [decision],
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      expect.objectContaining({ derivedDecisions: [decision] }),
    ]);
  });

  it('reloads a refused hop target from storage and re-attaches it to model replay', () => {
    const refusedUrl = 'https://blocked.example.test/page';
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'read',
        input: { path: 'https://docs.example.test/a' },
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: {
          status: 'error',
          type: 'permission_denied',
          message: REJECTED_HOP_MESSAGE,
          rejectedUrl: refusedUrl,
        },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      {
        type: 'tool-read',
        toolCallId: 'call-1',
        state: 'output-error',
        input: { path: 'https://docs.example.test/a' },
        errorText: REJECTED_HOP_MESSAGE,
        outcome: 'permission_denied',
        errorRejectedUrl: refusedUrl,
        classification: null,
      },
    ]);
    // The next turn replays the part: the model reads the fixed message plus
    // the target it names, so the blocked locator stays identifiable. The
    // failure renders as the JSON object every rendering uses, and `serialized`
    // is that payload inside a JSON string, so its quotes are escaped.
    const serialized = JSON.stringify(project(result.collector.parts()));
    expect(serialized).toContain(REJECTED_HOP_MESSAGE);
    expect(serialized).toContain(String.raw`\"rejectedUrl\":\"${refusedUrl}\"`);
  });

  it.each([
    [
      'the exact locator a hop rejection writes',
      rejectedHopUrl('https://blocked.example.test/page?token=secret#frag'),
      true,
    ],
    [
      'a locator exactly at the bound',
      `https://blocked.example.test/${'a'.repeat(
        REJECTED_URL_BOUND - 'https://blocked.example.test/'.length,
      )}`,
      true,
    ],
    ['a non-string value', 42, false],
    ['an empty string', '', false],
    [
      'a value past the bound',
      `https://blocked.example.test/${'a'.repeat(REJECTED_URL_BOUND)}`,
      false,
    ],
    [
      'a locator carrying userinfo',
      'https://user:secret@blocked.example.test/page',
      false,
    ],
    [
      'a locator carrying a query',
      'https://blocked.example.test/page?token=secret',
      false,
    ],
    [
      'a locator carrying a fragment',
      'https://blocked.example.test/page#frag',
      false,
    ],
    [
      'a locator carrying a control character',
      'https://blocked.example.test/pa\u0007ge',
      false,
    ],
    ['a non-web scheme', 'ftp://blocked.example.test/page', false],
    ['a relative locator', '/page', false],
    ['a noncanonical spelling', 'https://BLOCKED.example.test/page', false],
    [
      'an explicit default port',
      'https://blocked.example.test:443/page',
      false,
    ],
  ] as const)(
    're-reads %s from storage only while it is the exact locator a hop rejection writes',
    (_name, rejectedUrl, accepted) => {
      const result = reconstructDurableAssistant([
        event('tool.requested', {
          toolCallId: 'call-1',
          toolName: 'read',
          input: {},
        }),
        event('tool.completed', {
          toolCallId: 'call-1',
          output: {
            status: 'error',
            type: 'permission_denied',
            message: 'rejected',
            rejectedUrl,
          },
        }),
      ]);
      const [part] = result.collector.parts();

      expect(part).toMatchObject({ outcome: 'permission_denied' });
      if (accepted) {
        expect(part).toHaveProperty('errorRejectedUrl', rejectedUrl);
      } else {
        expect(part).not.toHaveProperty('errorRejectedUrl');
        expect(JSON.stringify(project(result.collector.parts()))).not.toContain(
          'rejectedUrl',
        );
      }
    },
  );

  it.each([
    ['another tool', 'knowledge_search', 'permission_denied'],
    ['another error type', 'read', 'network_error'],
  ] as const)(
    're-reads no refused target from a completion recorded for %s',
    (_name, toolName, type) => {
      const result = reconstructDurableAssistant([
        event('tool.requested', { toolCallId: 'call-1', toolName, input: {} }),
        event('tool.completed', {
          toolCallId: 'call-1',
          output: {
            status: 'error',
            type,
            message: 'rejected',
            rejectedUrl: 'https://blocked.example.test/page',
          },
        }),
      ]);
      const [part] = result.collector.parts();

      expect(part).not.toHaveProperty('errorRejectedUrl');
      expect(JSON.stringify(project(result.collector.parts()))).not.toContain(
        'rejectedUrl',
      );
    },
  );

  it('replays an ordinary error observation unchanged', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'search',
        input: { query: 'needle' },
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: {
          status: 'error',
          type: 'timeout',
          message: 'Tool timed out.',
        },
      }),
    ]);
    const [part] = result.collector.parts();

    expect(part).not.toHaveProperty('errorRejectedUrl');
    const serialized = JSON.stringify(project(result.collector.parts()));
    expect(serialized).toContain('Tool timed out.');
    expect(serialized).not.toContain('rejectedUrl');
  });

  it('ignores malformed, duplicate, and orphaned tool events while exposing open calls', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', { toolCallId: '', toolName: 'search' }),
      event('tool.requested', { toolCallId: 'call-1', toolName: '' }),
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'search',
        input: 1,
      }),
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'search',
        input: 2,
      }),
      event('tool.completed', {
        toolCallId: 'orphan',
        output: { status: 'success' },
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'partial' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([]);
    expect(result.openToolCalls).toEqual(
      new Map([['call-1', { toolName: 'search', toolInput: 1 }]]),
    );
  });

  it('ignores duplicate completion and malformed step-cap payloads', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', { toolCallId: 'call-1', toolName: 'search' }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success', value: 'done' },
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'error', type: 'late', message: 'late' },
      }),
      event('run.step_cap_reached', { stepsUsed: '4', maxSteps: 4 }),
      event('run.step_cap_reached', { stepsUsed: 4, maxSteps: 4 }),
    ]);

    expect(result.collector.parts()).toEqual([
      {
        type: 'tool-search',
        toolCallId: 'call-1',
        state: 'output-available',
        input: undefined,
        output: { status: 'success', value: 'done' },
        outcome: 'success',
        classification: null,
      },
      { type: 'data-cap-notice', data: { stepsUsed: 4, maxSteps: 4 } },
    ]);
  });

  it('records one step on the text and the two parallel calls it made', () => {
    const result = reconstructDurableAssistant([
      event('model.delta', { text: 'reading both', stepNumber: 2 }),
      event('tool.requested', {
        toolCallId: 'call-a',
        toolName: 'read',
        input: { path: '/work/a.md' },
        stepNumber: 2,
      }),
      event('tool.completed', {
        toolCallId: 'call-a',
        output: { status: 'success', text: 'a' },
      }),
      event('tool.requested', {
        toolCallId: 'call-b',
        toolName: 'read',
        input: { path: '/work/b.md' },
        stepNumber: 2,
      }),
      event('tool.completed', {
        toolCallId: 'call-b',
        output: { status: 'success', text: 'b' },
      }),
    ]);

    expect(result.collector.parts()).toStrictEqual([
      { type: 'text', text: 'reading both', step: 2 },
      expect.objectContaining({ toolCallId: 'call-a', step: 2 }),
      expect.objectContaining({ toolCallId: 'call-b', step: 2 }),
    ]);
  });

  it('numbers a Continue Run’s steps after the kept steps', () => {
    // The kept parts end with a call at step 1, so the Continue Run's own
    // first step (the SDK's step 0 in its fresh request) stores as step 2
    // (design D5).
    const result = reconstructDurableAssistant(
      [
        event('model.delta', { text: 'continuing', stepNumber: 0 }),
        event('tool.requested', {
          toolCallId: 'call-c',
          toolName: 'read',
          input: { path: '/work/c.md' },
          stepNumber: 0,
        }),
        event('tool.completed', {
          toolCallId: 'call-c',
          output: { status: 'success', text: 'c' },
        }),
        event('model.delta', { text: 'done', stepNumber: 1 }),
      ],
      2,
    );

    expect(result.collector.parts()).toStrictEqual([
      { type: 'text', text: 'continuing', step: 2 },
      expect.objectContaining({ toolCallId: 'call-c', step: 2 }),
      { type: 'text', text: 'done', step: 3 },
    ]);
  });

  it('writes no step onto a log that records none', () => {
    const result = reconstructDurableAssistant([
      event('model.delta', { text: 'old answer' }),
      event('reasoning.delta', { text: 'old thinking' }),
      event('tool.requested', {
        toolCallId: 'call-old',
        toolName: 'read',
        input: { path: '/work/old.md' },
      }),
      event('tool.completed', {
        toolCallId: 'call-old',
        output: { status: 'success', text: 'old' },
      }),
    ]);

    const parts = result.collector.parts();
    // An unnumbered step stays unnumbered: the projection's consecutive-call
    // rule reads it, and nothing here invents a step for it (design D5).
    for (const part of parts) expect(part).not.toHaveProperty('step');
  });

  it('splits a part when the log repeats one adapter id across steps', () => {
    // Chat Completions reuses `txt-0` and `reasoning-0` on every step; the
    // rebuilt parts keep each step's text apart, exactly as the live
    // collector did (design D5).
    const result = reconstructDurableAssistant([
      event('reasoning.delta', {
        text: 'think one',
        partId: 'rs-0',
        stepNumber: 0,
      }),
      event('model.delta', { text: 'one', partId: 'txt-0', stepNumber: 0 }),
      event('reasoning.delta', {
        text: 'think two',
        partId: 'rs-0',
        stepNumber: 1,
      }),
      event('model.delta', { text: 'two', partId: 'txt-0', stepNumber: 1 }),
    ]);

    expect(result.collector.parts()).toStrictEqual([
      { type: 'reasoning', text: 'think one', step: 0 },
      { type: 'text', text: 'one', step: 0 },
      { type: 'reasoning', text: 'think two', step: 1 },
      { type: 'text', text: 'two', step: 1 },
    ]);
  });

  it('rebuilds a refused call’s SDK text and input beside llame’s error', () => {
    const sdkErrorText =
      "Model tried to call unavailable tool 'fetch_page'. Available tools: read.";
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'fetch_page',
        input: { url: 'https://example.test/' },
        stepNumber: 1,
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: {
          status: 'error',
          type: 'not_available',
          message: 'Tool "fetch_page" is not available.',
        },
        sdkRefusal: {
          errorText: sdkErrorText,
          input: { url: 'https://example.test/' },
        },
      }),
    ]);

    const [part] = result.collector.parts();
    expect(part).toStrictEqual(
      expect.objectContaining({
        toolCallId: 'call-1',
        step: 1,
        // The owner-facing error stays llame's own message; the SDK's text and
        // input live beside it for the model only (design D3, proposal A8).
        errorText: 'Tool "fetch_page" is not available.',
        outcome: 'not_available',
        sdkRefusal: {
          errorText: sdkErrorText,
          input: { url: 'https://example.test/' },
        },
      }),
    );
  });

  it('drops a refused-call record without a usable error text or input', () => {
    for (const sdkRefusal of [
      { errorText: 7, input: {} },
      { errorText: 'bad input' },
    ]) {
      const [part] = reconstructDurableAssistant([
        event('tool.requested', {
          toolCallId: 'call-1',
          toolName: 'read',
          input: { path: '/work/a.md' },
        }),
        event('tool.completed', {
          toolCallId: 'call-1',
          output: { status: 'error', type: 'invalid_input', message: 'bad' },
          sdkRefusal,
        }),
      ]).collector.parts();

      expect(part).not.toHaveProperty('sdkRefusal');
    }
  });
});

describe('system-origin tool activity', () => {
  // Skill activation is llame's own read, not a call the model made. It is
  // recorded durably and excluded from the assistant transcript, so the model
  // never sees a fabricated call and the UI never replays one.
  const requested = (toolCallId: string) => ({
    toolCallId,
    toolName: 'read',
    input: { path: 'skill://pdf:raw' },
    origin: 'skill-activation',
  });

  it('produces no assistant part and no open call', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', requested('activation-1')),
      event('tool.completed', {
        toolCallId: 'activation-1',
        toolName: 'read',
        status: 'success',
        output: { status: 'success', content: 'instructions' },
        origin: 'skill-activation',
      }),
    ]);

    expect(result.collector.parts()).toEqual([]);
    // Nothing left open either: a system-origin request must not become a
    // synthesized settlement on recovery.
    expect(result.openToolCalls).toEqual(new Map());
  });

  it('produces no assistant part for an instructions-origin read', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'instructions-1',
        toolName: 'read',
        input: { path: '/repo/AGENTS.md:raw:1-2000' },
        origin: 'instructions',
      }),
      event('tool.completed', {
        toolCallId: 'instructions-1',
        toolName: 'read',
        status: 'success',
        output: { status: 'success', content: 'repo rules' },
        origin: 'instructions',
      }),
    ]);

    expect(result.collector.parts()).toEqual([]);
    expect(result.openToolCalls).toEqual(new Map());
  });

  it('produces no assistant part and no open call for a prompt-import-origin read', () => {
    const completed = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'prompt-import-1',
        toolName: 'read',
        input: { path: '/repo/README.md:30-35' },
        origin: 'prompt-import',
      }),
      event('tool.completed', {
        toolCallId: 'prompt-import-1',
        toolName: 'read',
        status: 'success',
        output: { status: 'success', content: 'readme' },
        origin: 'prompt-import',
      }),
    ]);
    expect(completed.collector.parts()).toEqual([]);
    expect(completed.openToolCalls).toEqual(new Map());

    // A request left open by a worker restart must not become a synthesized
    // settlement either: recovery never turns it into an assistant tool part.
    const open = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'prompt-import-2',
        toolName: 'read',
        input: { path: '/repo/README.md' },
        origin: 'prompt-import',
      }),
    ]);
    expect(open.collector.parts()).toEqual([]);
    expect(open.openToolCalls).toEqual(new Map());
  });

  it('leaves model-origin activity beside it untouched', () => {
    const result = reconstructDurableAssistant([
      event('tool.requested', requested('activation-1')),
      event('tool.completed', {
        toolCallId: 'activation-1',
        toolName: 'read',
        status: 'success',
        output: { status: 'success', content: 'instructions' },
        origin: 'skill-activation',
      }),
      event('tool.requested', {
        toolCallId: 'model-1',
        toolName: 'search',
        input: { query: 'needle' },
      }),
      event('tool.completed', {
        toolCallId: 'model-1',
        output: { status: 'success', value: 'found' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      expect.objectContaining({ toolCallId: 'model-1' }),
    ]);
  });

  it('treats activity without an origin as model-origin', () => {
    // Legacy events predate the discriminator and must keep replaying as the
    // model's own calls.
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'legacy-1',
        toolName: 'search',
        input: { query: 'needle' },
      }),
      event('tool.completed', {
        toolCallId: 'legacy-1',
        output: { status: 'success', value: 'found' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      expect.objectContaining({ toolCallId: 'legacy-1' }),
    ]);
  });

  it('ignores an unrecognized origin rather than trusting it', () => {
    // Only the shipped discriminator is system-origin; anything else is an
    // unknown value and stays model-origin rather than being silently treated
    // as llame's own activity.
    const result = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'other-1',
        toolName: 'search',
        input: { query: 'needle' },
        origin: 'some-other-caller',
      }),
      event('tool.completed', {
        toolCallId: 'other-1',
        output: { status: 'success', value: 'found' },
      }),
    ]);

    expect(result.collector.parts()).toEqual([
      expect.objectContaining({ toolCallId: 'other-1' }),
    ]);
  });
});

describe('stored tool-part classification (turn-actions D10)', () => {
  const reconstruct = (events: Array<RunEvent>) =>
    reconstructDurableAssistant(events).collector.parts();

  /** requested -> started (with `started`) -> completed, one `bash` call. */
  const bashCall = (started: { classification?: string } | undefined) => [
    event('tool.requested', {
      toolCallId: 'call-1',
      toolName: 'bash',
      input: { command: 'make' },
    }),
    ...(started === undefined
      ? []
      : [
          event('tool.started', {
            toolCallId: 'call-1',
            toolName: 'bash',
            ...started,
          }),
        ]),
    event('tool.completed', {
      toolCallId: 'call-1',
      output: { status: 'success', value: 'built' },
    }),
  ];

  it.each([
    ['a started call', { classification: 'execute_code' }, 'execute_code'],
    ['an MCP call', { classification: 'unverified' }, 'unverified'],
    ['a call whose started event recorded no classification', {}, undefined],
    [
      'a malformed recorded classification',
      { classification: 'not-a-classification' },
      undefined,
    ],
  ])('records %s as %s', (_name, started, expected: string | undefined) => {
    const [part] = reconstruct(bashCall(started));

    // An absent field is the legacy fallback, not "never started": only a
    // call with no `tool.started` records `null`.
    expect(part).toEqual(
      expect.objectContaining(
        expected === undefined ? {} : { classification: expected },
      ),
    );
    if (expected === undefined) {
      expect(part).not.toHaveProperty('classification');
    }
  });

  it('records no classification for a call that never started', () => {
    // A gate-rejected or permission-denied call emits requested then
    // completed, with no `tool.started`: nothing ran, so the part says so.
    const parts = reconstruct(bashCall(undefined));

    expect(parts).toEqual([
      expect.objectContaining({
        state: 'output-available',
        classification: null,
      }),
    ]);
  });

  it('keeps the classification out of the model-facing replay', () => {
    const parts = reconstruct([
      event('tool.requested', {
        toolCallId: 'call-1',
        toolName: 'bash',
        input: { command: 'make' },
      }),
      event('tool.started', {
        toolCallId: 'call-1',
        toolName: 'bash',
        classification: 'execute_code',
      }),
      event('tool.completed', {
        toolCallId: 'call-1',
        output: { status: 'success', value: 'built' },
      }),
    ]);

    const projection = project(parts);
    expect(JSON.stringify(projection)).not.toContain('execute_code');
  });
});

describe('an owner interrupt in the stored transcript (run-steering D7, D8)', () => {
  it('marks the reasoning part the stop cut, keeping its own provider metadata', () => {
    const collector = createAssistantPartCollector();
    collector.text('answer so far');
    collector.reasoning('half a thought', 'rs_2');
    collector.reasoning('', 'rs_2', { openai: { itemId: 'rs_2' } });

    collector.markInterrupted();

    expect(collector.parts()).toEqual([
      { type: 'text', text: 'answer so far' },
      {
        type: 'reasoning',
        text: 'half a thought',
        providerMetadata: {
          openai: { itemId: 'rs_2' },
          llame: { interrupted: true },
        },
      },
    ]);
  });

  it('marks nothing when the stop did not cut a reasoning part', () => {
    const collector = createAssistantPartCollector();
    collector.reasoning('finished thought');
    collector.text('streaming');

    collector.markInterrupted();

    expect(collector.parts()).toEqual([
      { type: 'reasoning', text: 'finished thought' },
      { type: 'text', text: 'streaming' },
    ]);
  });

  it('stores the interrupt marker on the settled call, beside its own cancelled marker', () => {
    const cancelled: ToolResult = {
      status: 'error',
      type: 'cancelled',
      message: 'The owner interrupted this call before it finished.',
    };

    const part = toolActivityPart({
      toolCallId: 'call_1',
      toolName: 'read',
      input: {},
      result: cancelled,
      interrupted: true,
    });

    expect(part).toMatchObject({
      state: 'output-error',
      outcome: 'cancelled',
      resultProviderMetadata: { llame: { cancelled: true, interrupted: true } },
    });
  });

  it('marks a result the call proved after the interrupt, and a plain cancel stays unmarked by it', () => {
    const proven = toolActivityPart({
      toolCallId: 'call_1',
      toolName: 'bash',
      input: {},
      result: { status: 'success', exitCode: 143, stdout: '', stderr: '' },
      interrupted: true,
    });
    const plain = toolActivityPart({
      toolCallId: 'call_2',
      toolName: 'read',
      input: {},
      result: { status: 'error', type: 'cancelled', message: 'cancelled' },
    });

    expect(proven).toMatchObject({
      state: 'output-available',
      resultProviderMetadata: { llame: { interrupted: true } },
    });
    expect(plain.resultProviderMetadata).toEqual({
      llame: { cancelled: true },
    });
  });

  it('a reply rebuilt from the event log keeps the marker of an interrupted call', () => {
    const parts = reconstructDurableAssistant([
      event('tool.requested', {
        toolCallId: 'call_1',
        toolName: 'bash',
        input: {},
      }),
      event('tool.completed', {
        toolCallId: 'call_1',
        toolName: 'bash',
        status: 'error',
        output: {
          status: 'error',
          type: 'outcome_unknown',
          message: 'The host command was interrupted.',
        },
        interrupted: true,
      }),
    ]).collector.parts();

    expect(parts).toMatchObject([
      { resultProviderMetadata: { llame: { interrupted: true } } },
    ]);
  });
});
