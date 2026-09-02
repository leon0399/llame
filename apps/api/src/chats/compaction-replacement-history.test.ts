import {
  isStoredReplacementToolPart,
  parseCompactionReplacementHistory,
  parseToolObservationOmission,
  renderToolObservationOmission,
} from './compaction-replacement-history';

const omission = (count: number) => ({
  type: 'text' as const,
  text: renderToolObservationOmission(count),
});

const toolPart = {
  type: 'tool-search_conversations' as const,
  toolCallId: 'call-1',
  state: 'output-available' as const,
  input: {},
  output: 'one result',
  outcome: 'success',
};

const userMessage = {
  role: 'user' as const,
  parts: [{ type: 'text' as const, text: 'checkpoint' }],
};

describe('compaction replacement history', () => {
  it('renders and parses a positive omission count', () => {
    const text = renderToolObservationOmission(3);

    expect(text).toBe(
      '[3 earlier tool observations omitted to fit replay budget.]',
    );
    expect(parseToolObservationOmission({ type: 'text', text })).toBe(3);
  });

  it.each([
    undefined,
    null,
    {},
    { type: 'tool', text: 'irrelevant' },
    {
      type: 'text',
      text: '3 earlier tool observations omitted to fit replay budget.',
    },
    {
      type: 'text',
      text: '[0 earlier tool observations omitted to fit replay budget.]',
    },
    {
      type: 'text',
      text: '[3 earlier tool observations omitted to fit replay budget]',
    },
  ])('rejects malformed omission markers: %j', (value) => {
    expect(parseToolObservationOmission(value)).toBeNull();
  });

  it('accepts a fully valid stored replacement tool part', () => {
    expect(isStoredReplacementToolPart(toolPart)).toBe(true);
  });

  it.each([
    ['type', { ...toolPart, type: 'tool-' }],
    ['tool name', { ...toolPart, type: 'tool/search' }],
    ['call id', { ...toolPart, toolCallId: 'call id' }],
    ['state', { ...toolPart, state: 'input-available' }],
    ['input', { ...toolPart, input: { query: 'secret' } }],
    ['output', { ...toolPart, output: '' }],
    ['outcome', { ...toolPart, outcome: 'failed!' }],
  ] as const)(
    'rejects a replacement tool part with an invalid %s',
    (_field, value) => {
      expect(isStoredReplacementToolPart(value)).toBe(false);
    },
  );

  it('accepts a user checkpoint, stored tool parts, and a final omission marker', () => {
    const history = [
      userMessage,
      { role: 'assistant' as const, parts: [toolPart] },
      { role: 'assistant' as const, parts: [omission(2)] },
    ];

    expect(parseCompactionReplacementHistory(history)).toEqual(history);
  });

  it('rejects invalid replacement histories', () => {
    const invalid = [
      [],
      [
        userMessage,
        { role: 'user', parts: [{ type: 'text', text: 'wrong role' }] },
      ],
      [userMessage, { role: 'assistant', parts: [toolPart, toolPart] }],
      [userMessage, { role: 'user', parts: [toolPart] }],
      [
        userMessage,
        { role: 'assistant', parts: [{ type: 'text', text: 'arbitrary' }] },
      ],
      [
        userMessage,
        { role: 'assistant', parts: [omission(2)] },
        { role: 'assistant', parts: [toolPart] },
      ],
    ];

    for (const history of invalid) {
      expect(parseCompactionReplacementHistory(history)).toBeNull();
    }
  });
});
