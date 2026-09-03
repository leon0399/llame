import {
  createAssistantPartCollector,
  REASONING_PERSIST_MAX,
  assistantParts,
} from '../runs/assistant-transcript';
import { isRecord } from '../unknown-record';

function isPartWithText(part: unknown): part is { type: string; text: string } {
  return (
    isRecord(part) &&
    typeof part.type === 'string' &&
    typeof part.text === 'string'
  );
}

describe('assistantParts (reasoning + tool + cap-notice ordering)', () => {
  it('preserves reasoning/text/tool occurrence order instead of regrouping parts on reload', () => {
    const collector = createAssistantPartCollector();
    const toolPart = {
      type: 'tool-search_conversations' as const,
      toolCallId: 'c1',
      state: 'output-available' as const,
      input: { query: 'budget' },
      output: { status: 'success', results: [] },
      outcome: 'success',
    };

    collector.reasoning('think first');
    collector.text('checking ');
    collector.tool(toolPart);
    collector.reasoning('after tool');
    collector.text('final answer');

    expect(collector.parts()).toEqual([
      { type: 'reasoning', text: 'think first' },
      { type: 'text', text: 'checking ' },
      toolPart,
      { type: 'reasoning', text: 'after tool' },
      { type: 'text', text: 'final answer' },
    ]);
  });

  it('retains tool request order when concurrent calls complete in reverse', () => {
    const collector = createAssistantPartCollector();
    const first = {
      type: 'tool-search_conversations' as const,
      toolCallId: 'first',
      state: 'output-available' as const,
      input: { query: 'first' },
      output: { status: 'success', results: [] },
      outcome: 'success',
    };
    const second = {
      type: 'tool-search_conversations' as const,
      toolCallId: 'second',
      state: 'output-available' as const,
      input: { query: 'second' },
      output: { status: 'success', results: [] },
      outcome: 'success',
    };

    collector.toolRequested(first.toolCallId);
    collector.toolRequested(second.toolCallId);
    collector.tool(second);
    collector.tool(first);

    expect(collector.parts()).toEqual([first, second]);
  });

  it('inserts a paragraph break between glued reasoning-summary headings', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('**Investigating likely culprit PRs**');
    collector.reasoning('**Inspecting message schema**');

    expect(collector.parts()).toEqual([
      {
        type: 'reasoning',
        text: '**Investigating likely culprit PRs**\n\n**Inspecting message schema**',
      },
    ]);
  });

  it('unglues a first reasoning chunk that already contains multiple summary parts', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('**A****B**');

    expect(collector.parts()).toEqual([
      { type: 'reasoning', text: '**A**\n\n**B**' },
    ]);
  });

  it('starts a new reasoning part when the SDK part id changes', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('**Investigating**', 'rs_1:0');
    collector.reasoning('**Inspecting schema**', 'rs_1:1');

    expect(collector.parts()).toEqual([
      { type: 'reasoning', text: '**Investigating**' },
      { type: 'reasoning', text: '**Inspecting schema**' },
    ]);
  });

  it('concatenates deltas that share an SDK part id without unglue', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning('**Investigating**', 'rs_1:0');
    collector.reasoning(' the logs', 'rs_1:0');

    expect(collector.parts()).toEqual([
      { type: 'reasoning', text: '**Investigating** the logs' },
    ]);
  });

  it('does not persist breaks at streaming chunk boundaries inside inline emphasis', () => {
    const collector = createAssistantPartCollector();
    const streamed =
      'the**quick**fix for the**root**cause of the**timeout**issue.';

    for (const character of streamed) {
      collector.reasoning(character);
    }

    expect(collector.parts()).toEqual([{ type: 'reasoning', text: streamed }]);
  });

  it('inserts a paragraph break when a summary heading butts onto prior prose', () => {
    const collector = createAssistantPartCollector();

    collector.reasoning(
      '**Simulating a greeting stream**\n\nIt feels like a streaming interaction!',
    );
    collector.reasoning(
      '**Simulating a greeting stream**\n\nI want to meet the request.',
    );

    expect(collector.parts()).toEqual([
      {
        type: 'reasoning',
        text: '**Simulating a greeting stream**\n\nIt feels like a streaming interaction!\n\n**Simulating a greeting stream**\n\nI want to meet the request.',
      },
    ]);
  });

  it('text-only when there was no reasoning (no empty reasoning part)', () => {
    expect(
      assistantParts({ reasoningText: '', toolParts: [], text: 'the answer' }),
    ).toEqual([{ type: 'text', text: 'the answer' }]);
  });

  it('prepends a reasoning part before the text when reasoning is present', () => {
    expect(
      assistantParts({
        reasoningText: 'let me think',
        toolParts: [],
        text: 'the answer',
      }),
    ).toEqual([
      { type: 'reasoning', text: 'let me think' },
      { type: 'text', text: 'the answer' },
    ]);
  });

  it('caps an oversized reasoning blob (bounds storage + per-turn read cost)', () => {
    // Independent of REASONING_PERSIST_MAX: sizing the input and the expected
    // output from the same import moves both together, so any cap ships green.
    const huge = 'x'.repeat(30_000);
    const [reasoning, text] = assistantParts({
      reasoningText: huge,
      toolParts: [],
      text: 'answer',
    });
    if (!isPartWithText(reasoning) || !isPartWithText(text)) {
      throw new Error('Expected reasoning and text parts with a text field');
    }
    expect(reasoning.type).toBe('reasoning');
    // Truncated to the cap + a marker; never the full oversized blob.
    expect(REASONING_PERSIST_MAX).toBe(24_000);
    expect(reasoning.text.length).toBe(24_001);
    expect(reasoning.text.endsWith('…')).toBe(true);
    expect(text).toEqual({ type: 'text', text: 'answer' });
  });

  it('reasoning-only turn: no empty text part when there is no answer text', () => {
    expect(
      assistantParts({
        reasoningText: 'thinking, no answer yet',
        toolParts: [],
        text: '',
      }),
    ).toEqual([{ type: 'reasoning', text: 'thinking, no answer yet' }]);
  });

  it('empty everything: no parts at all (not even an empty text part)', () => {
    expect(
      assistantParts({ reasoningText: '', toolParts: [], text: '' }),
    ).toEqual([]);
  });

  it('orders reasoning, then tool parts, then text, then an optional cap notice', () => {
    const toolPart = {
      type: 'tool-search_conversations' as const,
      toolCallId: 'c1',
      state: 'output-available' as const,
      input: { query: 'budget' },
      output: { status: 'success', results: [] },
      outcome: 'success',
    };
    expect(
      assistantParts({
        reasoningText: 'thinking',
        toolParts: [toolPart],
        text: 'the answer',
        capNotice: {
          type: 'data-cap-notice',
          data: { stepsUsed: 8, maxSteps: 8 },
        },
      }),
    ).toEqual([
      { type: 'reasoning', text: 'thinking' },
      toolPart,
      { type: 'text', text: 'the answer' },
      { type: 'data-cap-notice', data: { stepsUsed: 8, maxSteps: 8 } },
    ]);
  });

  it('multiple tool parts persist in occurrence order', () => {
    const first = {
      type: 'tool-search_conversations' as const,
      toolCallId: 'c1',
      state: 'output-available' as const,
      input: { query: 'a' },
      output: { status: 'success', results: [] },
      outcome: 'success',
    };
    const second = {
      type: 'tool-search_conversations' as const,
      toolCallId: 'c2',
      state: 'output-error' as const,
      input: { query: 'b' },
      errorText: 'The search could not complete.',
      outcome: 'search_failed',
    };
    expect(
      assistantParts({
        reasoningText: '',
        toolParts: [first, second],
        text: 'done',
      }),
    ).toEqual([first, second, { type: 'text', text: 'done' }]);
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
    collector.tool({
      type: 'tool-search_conversations',
      toolCallId: 'c1',
      state: 'output-available',
      input: { query: 'x' },
      output: { status: 'success', results: [] },
      outcome: 'success',
    });

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
