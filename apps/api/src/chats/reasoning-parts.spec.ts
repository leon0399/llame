import {
  createAssistantPartCollector,
  REASONING_PERSIST_MAX,
  assistantParts,
} from '../runs/run-execution.service';

describe('assistantParts (reasoning + tool + cap-notice ordering)', () => {
  it('preserves reasoning/text/tool occurrence order instead of regrouping parts on reload', () => {
    const collector = createAssistantPartCollector();
    const toolPart = {
      type: 'tool-search_conversations' as const,
      toolCallId: 'c1',
      state: 'output-available' as const,
      input: { query: 'budget' },
      output: { status: 'success', results: [] },
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
    };
    const second = {
      type: 'tool-search_conversations' as const,
      toolCallId: 'second',
      state: 'output-available' as const,
      input: { query: 'second' },
      output: { status: 'success', results: [] },
    };

    collector.toolRequested(first.toolCallId);
    collector.toolRequested(second.toolCallId);
    collector.tool(second);
    collector.tool(first);

    expect(collector.parts()).toEqual([first, second]);
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
    const huge = 'x'.repeat(REASONING_PERSIST_MAX + 5000);
    const [reasoning, text] = assistantParts({
      reasoningText: huge,
      toolParts: [],
      text: 'answer',
    }) as [{ type: string; text: string }, { type: string; text: string }];
    expect(reasoning.type).toBe('reasoning');
    // Truncated to the cap + a marker; never the full oversized blob.
    expect(reasoning.text.length).toBe(REASONING_PERSIST_MAX + 1);
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
    };
    const second = {
      type: 'tool-search_conversations' as const,
      toolCallId: 'c2',
      state: 'output-error' as const,
      input: { query: 'b' },
      errorText: 'The search could not complete.',
    };
    expect(
      assistantParts({
        reasoningText: '',
        toolParts: [first, second],
        text: 'done',
      }),
    ).toEqual([first, second, { type: 'text', text: 'done' }]);
  });
});
