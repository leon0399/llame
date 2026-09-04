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

const TEXT_PART = { type: 'text' as const, text: 'checkpoint' };

describe('compaction replacement history bounds', () => {
  it('accepts a token of exactly the maximum length', () => {
    expect(
      isStoredReplacementToolPart({
        ...toolPart,
        type: `tool-${'a'.repeat(64)}`,
        toolCallId: 'c'.repeat(1024),
        outcome: 'o'.repeat(128),
      }),
    ).toBe(true);
  });

  it.each([
    ['tool name', { ...toolPart, type: `tool-${'a'.repeat(65)}` }],
    ['call id', { ...toolPart, toolCallId: 'c'.repeat(1025) }],
    ['outcome', { ...toolPart, outcome: 'o'.repeat(129) }],
  ] as const)('rejects an over-long %s', (_field, value) => {
    expect(isStoredReplacementToolPart(value)).toBe(false);
  });

  it.each([
    ['a non-record', 'tool-search_conversations'],
    ['a non-string type', { ...toolPart, type: 42 }],
    ['a non-string call id', { ...toolPart, toolCallId: 42 }],
    ['a non-string outcome', { ...toolPart, outcome: 42 }],
  ] as const)('rejects %s as a stored tool part', (_description, value) => {
    expect(isStoredReplacementToolPart(value)).toBe(false);
  });
});

describe('tool observation omission parsing', () => {
  it('parses a multi-digit count', () => {
    expect(parseToolObservationOmission(omission(12))).toBe(12);
    expect(parseToolObservationOmission(omission(1234))).toBe(1234);
  });

  it.each([
    [
      'a marker on a non-text part',
      {
        type: 'tool-search',
        text: '[3 earlier tool observations omitted to fit replay budget.]',
      },
    ],
    [
      'a zero-padded count that would not round-trip',
      {
        type: 'text',
        text: '[03 earlier tool observations omitted to fit replay budget.]',
      },
    ],
  ] as const)('rejects %s', (_description, value) => {
    expect(parseToolObservationOmission(value)).toBeNull();
  });
});

describe('compaction replacement history structure', () => {
  it.each([
    ['a non-record message', ['not a record']],
    ['a non-record leading part', [{ role: 'user', parts: [null] }]],
    [
      'a leading part that is not text',
      [{ role: 'user', parts: [{ type: 'note', text: 'checkpoint' }] }],
    ],
    [
      'a whitespace-only checkpoint',
      [{ role: 'user', parts: [{ type: 'text', text: '   ' }] }],
    ],
    [
      'a non-record part after the checkpoint',
      [
        { role: 'user', parts: [TEXT_PART] },
        { role: 'assistant', parts: [7] },
      ],
    ],
  ] as const)('rejects %s', (_description, history) => {
    expect(parseCompactionReplacementHistory(history)).toBeNull();
  });
});
