import { parseJsonEventStream } from '@ai-sdk/provider-utils';
import {
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import { isRecord, isString } from '@workspace/runtime-safety';

import {
  createAssistantPartCollector,
  reconstructDurableAssistant,
  toolActivityPart,
} from '../runs/assistant-transcript';
import {
  createRunEventTranslator,
  type UiChunk,
} from '../runs/run-stream-bridge';
import type { RunEvent } from '../db/schema';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const timestamp = new Date('2026-09-02T12:00:00.000Z');

// eslint-disable-next-line anti-slop/no-unknown-parameters -- test fixture intentionally feeds persisted payload shapes through the replay boundary.
function event(eventType: string, payload: unknown): RunEvent {
  return {
    sequence: 1,
    runId: RUN_ID,
    eventType,
    payload,
    createdAt: timestamp,
  };
}

function toolPart(toolCallId: string) {
  return {
    type: 'tool-search_conversations' as const,
    toolCallId,
    state: 'output-available' as const,
    input: { query: 'schema' },
    output: { status: 'success', results: [] },
    outcome: 'success',
  };
}

function reasoningTexts(parts: ReadonlyArray<unknown>): Array<string> {
  return parts.flatMap((part) => {
    if (!isRecord(part) || part.type !== 'reasoning') return [];
    return isString(part.text) ? [part.text] : [];
  });
}

/** Rebuild the UI parts a browser would hold after consuming the chunk stream. */
async function uiPartsFromChunks(
  chunks: ReadonlyArray<UiChunk>,
): Promise<UIMessage['parts']> {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`);
  const parsed = parseJsonEventStream({
    stream: new Blob(body).stream(),
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream<
      | { success: true; value: UIMessageChunk }
      | { success: false; error: Error },
      UIMessageChunk
    >({
      transform(result, controller) {
        if (!result.success) {
          throw result.error;
        }
        controller.enqueue(result.value);
      },
    }),
  );

  let reconstructed: UIMessage | undefined;
  for await (const message of readUIMessageStream({ stream: parsed })) {
    reconstructed = message;
  }
  if (reconstructed === undefined) {
    throw new Error('Expected the UI chunk stream to reconstruct a message');
  }
  return reconstructed.parts;
}

function chunksFrom(events: Array<RunEvent>): Array<UiChunk> {
  const translator = createRunEventTranslator(RUN_ID);
  return events.flatMap((runEvent) => translator.translate(runEvent));
}

describe('AssistantPartCollector reasoning part identity (D8)', () => {
  it('stores one reasoning part per adapter id, in order, when the id changes', () => {
    const collector = createAssistantPartCollector();

    // The Responses wire ids every summary `${itemId}:${summaryIndex}`.
    collector.reasoning('**Investigating**', 'rs_1:0');
    collector.reasoning(' the message schema', 'rs_1:0');
    collector.reasoning('**Inspecting the tool**', 'rs_1:1');

    expect(collector.parts()).toEqual([
      { type: 'reasoning', text: '**Investigating** the message schema' },
      { type: 'reasoning', text: '**Inspecting the tool**' },
    ]);
  });

  it('keeps an uninterrupted constant-id stream as one part', () => {
    const collector = createAssistantPartCollector();

    // The compatible wire ids every event with the constant `reasoning-0`.
    collector.reasoning('looking ', 'reasoning-0');
    collector.reasoning('up the ', 'reasoning-0');
    collector.reasoning('schema', 'reasoning-0');

    expect(collector.parts()).toEqual([
      { type: 'reasoning', text: 'looking up the schema' },
    ]);
  });

  it('splits reasoning around a tool call even under one constant adapter id', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('before the tool', 'reasoning-0');
    collector.toolRequested('c1');
    collector.tool(toolPart('c1'));
    collector.reasoning('after the tool', 'reasoning-0');

    expect(collector.parts()).toEqual([
      { type: 'reasoning', text: 'before the tool' },
      toolPart('c1'),
      { type: 'reasoning', text: 'after the tool' },
    ]);
  });

  it('does not split on an undefined ↔ defined adapter id transition', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('first ');
    // Defined follows absent: append, and the defined id becomes the open
    // part's id — an absent id is "no information", not a new part.
    collector.reasoning('second', 'rs_1:0');
    // Absent follows defined: append without clearing the known id.
    collector.reasoning(' third');

    expect(collector.parts()).toEqual([
      { type: 'reasoning', text: 'first second third' },
    ]);

    // The adopted id still bounds the part: a different defined id splits.
    collector.reasoning('fourth', 'rs_1:1');
    expect(collector.parts()).toEqual([
      { type: 'reasoning', text: 'first second third' },
      { type: 'reasoning', text: 'fourth' },
    ]);
  });
});

describe('AssistantPartCollector occurrence order', () => {
  it('preserves reasoning/text/tool occurrence order instead of regrouping parts on reload', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('think first');
    collector.text('checking ');
    collector.tool(toolPart('c1'));
    collector.reasoning('after tool');
    collector.text('final answer');

    expect(collector.parts()).toEqual([
      { type: 'reasoning', text: 'think first' },
      { type: 'text', text: 'checking ' },
      toolPart('c1'),
      { type: 'reasoning', text: 'after tool' },
      { type: 'text', text: 'final answer' },
    ]);
  });

  it('retains tool request order when concurrent calls complete in reverse', () => {
    const collector = createAssistantPartCollector();
    const first = toolPart('first');
    const second = toolPart('second');

    collector.toolRequested(first.toolCallId);
    collector.toolRequested(second.toolCallId);
    collector.tool(second);
    collector.tool(first);

    expect(collector.parts()).toEqual([first, second]);
  });

  it('keeps the first settlement when a tool completes after termination', () => {
    const collector = createAssistantPartCollector();

    collector.toolRequested('c1');
    // Termination settles the call through the same path a real result takes,
    // so the run event and the persisted part can never disagree.
    collector.tool({
      type: 'tool-search_conversations',
      toolCallId: 'c1',
      state: 'output-error',
      input: undefined,
      errorText: 'The run was cancelled before this tool finished.',
      outcome: 'cancelled',
    });

    // Cooperative cancellation is best-effort, so a late genuine result is
    // expected rather than exotic. It must not replace the settlement or
    // append a second record for the same call.
    collector.tool(toolPart('c1'));

    expect(collector.parts()).toEqual([
      {
        type: 'tool-search_conversations',
        toolCallId: 'c1',
        state: 'output-error',
        input: undefined,
        errorText: 'The run was cancelled before this tool finished.',
        outcome: 'cancelled',
      },
    ]);
  });
});

describe('assistant reasoning part identity across live, replay, and history', () => {
  // One turn, its reasoning id changing, then a tool, then the second id
  // resuming — the shape D8 has to reproduce identically on every path.
  const turnEvents: Array<RunEvent> = [
    event('reasoning.delta', { text: '**Investigating** ', partId: 'rs_1:0' }),
    event('reasoning.delta', {
      text: 'the message schema.',
      partId: 'rs_1:0',
    }),
    event('reasoning.delta', {
      text: '**Inspecting the tool**',
      partId: 'rs_1:1',
    }),
    // The Responses adapter's reasoning ends: the earlier summary's end
    // carries the item id alone, the item's last end carries it with the
    // encrypted content.
    event('reasoning.delta', {
      partId: 'rs_1:0',
      providerMetadata: { openai: { itemId: 'rs_1' } },
    }),
    event('reasoning.delta', {
      partId: 'rs_1:1',
      providerMetadata: {
        openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' },
      },
    }),
    event('tool.requested', {
      toolCallId: 'c1',
      toolName: 'search_conversations',
      input: { query: 'schema' },
    }),
    event('tool.completed', {
      toolCallId: 'c1',
      output: { status: 'success', value: 'found' },
    }),
    event('reasoning.delta', { text: '**After the tool**', partId: 'rs_1:1' }),
    event('model.delta', { text: 'the answer' }),
    event('run.completed', null),
  ];

  it('produces identical parts from live collection, reconnect replay, and the durable log', async () => {
    // Live collection: the run's stream callbacks feeding the collector as
    // they arrive (never going through the event log).
    const live = createAssistantPartCollector();
    live.reasoning('**Investigating** ', 'rs_1:0');
    live.reasoning('the message schema.', 'rs_1:0');
    live.reasoning('**Inspecting the tool**', 'rs_1:1');
    live.reasoning('', 'rs_1:0', { openai: { itemId: 'rs_1' } });
    live.reasoning('', 'rs_1:1', {
      openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' },
    });
    live.toolRequested('c1');
    live.tool(
      toolActivityPart({
        toolCallId: 'c1',
        toolName: 'search_conversations',
        input: { query: 'schema' },
        result: { status: 'success', value: 'found' },
      }),
    );
    live.reasoning('**After the tool**', 'rs_1:1');
    live.text('the answer');

    // Replayed history: the durable reconstructor over the append-only log.
    const durable = reconstructDurableAssistant(turnEvents).collector.parts();
    expect(durable).toEqual(live.parts());
    expect(durable).toEqual([
      {
        type: 'reasoning',
        text: '**Investigating** the message schema.',
        providerMetadata: { openai: { itemId: 'rs_1' } },
      },
      {
        type: 'reasoning',
        text: '**Inspecting the tool**',
        providerMetadata: {
          openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' },
        },
      },
      expect.objectContaining({
        type: 'tool-search_conversations',
        toolCallId: 'c1',
        state: 'output-available',
      }),
      { type: 'reasoning', text: '**After the tool**' },
      { type: 'text', text: 'the answer' },
    ]);

    // Live output and reconnect replay: the same durable rows translated from
    // sequence zero by a fresh bridge translator, then parsed by the real UI
    // chunk transport.
    const liveChunks = chunksFrom(turnEvents);
    const reconnectChunks = chunksFrom(turnEvents);
    expect(reconnectChunks).toEqual(liveChunks);

    const liveUi = await uiPartsFromChunks(liveChunks);
    const reconnectUi = await uiPartsFromChunks(reconnectChunks);
    expect(reconnectUi).toEqual(liveUi);

    expect(reasoningTexts(liveUi)).toEqual(reasoningTexts(durable));
    const uiKinds = liveUi.map((part) =>
      isRecord(part) ? part.type : undefined,
    );
    const durableKinds = durable.map((part) =>
      isRecord(part) ? part.type : undefined,
    );
    expect(uiKinds).toEqual([
      'reasoning',
      'reasoning',
      'dynamic-tool',
      'reasoning',
      'text',
    ]);
    expect(durableKinds).toEqual([
      'reasoning',
      'reasoning',
      'tool-search_conversations',
      'reasoning',
      'text',
    ]);

    // The opaque provider metadata is durable on the part and private to the
    // provider request: the UI chunk stream (live and reconnect) never
    // carries it, and the browser's parsed message holds none of it.
    expect(JSON.stringify(liveChunks)).not.toContain('providerMetadata');
    expect(JSON.stringify(liveUi)).not.toContain('itemId');
    expect(JSON.stringify(liveUi)).not.toContain('reasoningEncryptedContent');
  });
});

describe('reasoning blocks a provider withheld (D18)', () => {
  const firstSignature = { anthropic: { signature: 'SIG_STEP_1' } };
  const secondSignature = { anthropic: { signature: 'SIG_STEP_2' } };
  const redacted = { anthropic: { redactedData: 'REDACTED_BLOCK' } };

  it('persists two withheld blocks of consecutive tool steps as two parts, each with its own signature', async () => {
    // The Messages adapter numbers a response's blocks from zero, so a tool
    // turn that withholds the text of the thinking block in two consecutive
    // steps delivers two different blocks under the same raw id. The client
    // scopes that id to the provider step, and each block's signature is
    // recorded under the scoped id — neither may lose its signature to the
    // other, and a later request replays both in step order.
    const turnEvents: Array<RunEvent> = [
      event('reasoning.delta', {
        partId: '0:0',
        providerMetadata: firstSignature,
      }),
      event('tool.requested', {
        toolCallId: 'c1',
        toolName: 'search_conversations',
        input: { query: 'schema' },
      }),
      event('tool.completed', {
        toolCallId: 'c1',
        output: { status: 'success', value: 'found' },
      }),
      event('reasoning.delta', {
        partId: '1:0',
        providerMetadata: secondSignature,
      }),
      event('model.delta', { text: 'the answer' }),
      event('run.completed', null),
    ];
    const live = createAssistantPartCollector();
    live.reasoning('', '0:0', firstSignature);
    live.toolRequested('c1');
    live.tool(
      toolActivityPart({
        toolCallId: 'c1',
        toolName: 'search_conversations',
        input: { query: 'schema' },
        result: { status: 'success', value: 'found' },
      }),
    );
    live.reasoning('', '1:0', secondSignature);
    live.text('the answer');

    const durable = reconstructDurableAssistant(turnEvents).collector.parts();
    expect(durable).toEqual(live.parts());
    expect(durable).toEqual([
      { type: 'reasoning', text: '', providerMetadata: firstSignature },
      expect.objectContaining({ type: 'tool-search_conversations' }),
      { type: 'reasoning', text: '', providerMetadata: secondSignature },
      { type: 'text', text: 'the answer' },
    ]);

    // The persisted part stays provider-only: neither live delivery nor
    // reconnect replay emits a UI chunk for the metadata-only event.
    const translator = createRunEventTranslator(RUN_ID);
    expect(
      translator.translate(
        event('reasoning.delta', {
          partId: '2:0',
          providerMetadata: { anthropic: { signature: 'SIG_ISOLATED' } },
        }),
      ),
    ).toEqual([]);
    const chunks = chunksFrom(turnEvents);
    expect(JSON.stringify(chunks)).not.toContain('providerMetadata');
    expect(JSON.stringify(chunks)).not.toContain('SIG_STEP');
    const ui = await uiPartsFromChunks(chunks);
    expect(ui.some((part) => isRecord(part) && part.type === 'reasoning')).toBe(
      false,
    );
  });

  it('records the text that precedes a part-starting metadata delivery first, on both paths', () => {
    // A redacted block opens with a metadata-only delivery under an id no part
    // carries. Text streamed before it belongs ahead of the empty part in the
    // log — the run loop flushes that buffer before recording the delivery,
    // and this is the durable order it produces.
    const turnEvents: Array<RunEvent> = [
      event('model.delta', { text: 'the answer so far' }),
      event('reasoning.delta', { partId: '0:0', providerMetadata: redacted }),
    ];
    const live = createAssistantPartCollector();
    live.text('the answer so far');
    live.reasoning('', '0:0', redacted);

    expect(reconstructDurableAssistant(turnEvents).collector.parts()).toEqual(
      live.parts(),
    );
    expect(live.parts()).toEqual([
      { type: 'text', text: 'the answer so far' },
      { type: 'reasoning', text: '', providerMetadata: redacted },
    ]);
  });

  it('replays a Responses item whose summary was empty as an empty part with its metadata', async () => {
    // `summaryParts[0]` is registered when the item is added and concluded
    // when it is done whether or not a delta arrived: an item with no summary
    // text is two metadata-only deliveries, so it persists as an empty part
    // whose encryption a later request replays (an item reference on a stored
    // request).
    const itemMetadata = {
      openai: { itemId: 'rs_empty', reasoningEncryptedContent: 'enc-empty' },
    };
    const turnEvents: Array<RunEvent> = [
      event('reasoning.delta', {
        text: 'the earlier summary',
        partId: '0:rs_1:0',
      }),
      event('reasoning.delta', {
        partId: '0:rs_1:0',
        providerMetadata: { openai: { itemId: 'rs_1' } },
      }),
      event('reasoning.delta', {
        partId: '0:rs_empty:0',
        providerMetadata: itemMetadata,
      }),
      event('model.delta', { text: 'the answer' }),
    ];
    const live = createAssistantPartCollector();
    live.reasoning('the earlier summary', '0:rs_1:0');
    live.reasoning('', '0:rs_1:0', { openai: { itemId: 'rs_1' } });
    live.reasoning('', '0:rs_empty:0', itemMetadata);
    live.text('the answer');

    const durable = reconstructDurableAssistant(turnEvents).collector.parts();
    expect(durable).toEqual(live.parts());
    expect(durable).toEqual([
      {
        type: 'reasoning',
        text: 'the earlier summary',
        providerMetadata: { openai: { itemId: 'rs_1' } },
      },
      { type: 'reasoning', text: '', providerMetadata: itemMetadata },
      { type: 'text', text: 'the answer' },
    ]);

    // The empty part reaches the browser only as text-less nothing: no chunk
    // is emitted for it, so the rendered parts hold one reasoning segment.
    const ui = await uiPartsFromChunks(chunksFrom(turnEvents));
    expect(reasoningTexts(ui)).toEqual(['the earlier summary']);
  });
});
