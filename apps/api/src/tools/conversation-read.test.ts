import { drizzle } from 'drizzle-orm/postgres-js';
import { ZodError } from 'zod';

import {
  MessagesRepository,
  type ConversationMessageLookup,
} from '../chats/chats-repository';
import { visibleMessageText } from '../chats/conversation-evidence';
import * as schema from '../db/schema';
import {
  barePlaceholder,
  type MediaDescriptor,
} from '../media/media-descriptors';
import { descriptor } from '../media/media-fixtures';
import { truncateOversizedResult } from '@workspace/runtime-safety';
import {
  CONVERSATION_HISTORY_NOTICE,
  CONVERSATION_READ_RESULT_MAX_CODE_UNITS,
  type ConversationReadSuccess,
  conversationReadInputSchema,
  conversationReadTool,
  executeConversationRead,
  renderConversationRead,
  selectLargestConversationReadPrefix,
  scanConversationLogicalLines,
} from './conversation-read';
import { conversationSourceCoordinatesSchema } from './conversation-source-coordinates';
import { neutralizeToolResult } from '../chats/tool-observation-part';

const CHAT_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = '00000000-0000-4000-8000-000000000002';
const CREATED_AT = new Date('2026-08-27T12:00:00.000Z');

function lookup(
  text: string,
  overrides: Partial<ConversationMessageLookup> = {},
): ConversationMessageLookup {
  return {
    chatId: CHAT_ID,
    seq: 7,
    role: 'assistant',
    parts: [{ type: 'text', text }],
    usage: { status: 'completed' },
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function mockDb(result: ConversationMessageLookup | undefined) {
  const db = drizzle.mock({ schema });
  const find = vi
    .spyOn(MessagesRepository.prototype, 'findConversationMessage')
    .mockResolvedValue(result);
  return { db, find };
}

describe('conversation_read input', () => {
  afterEach(() => vi.restoreAllMocks());

  it('describes an exact numbered read without implementation fields', () => {
    expect(conversationReadTool.description).toContain('exact');
    expect(conversationReadTool.description).toContain('numbered lines');
    expect(conversationReadTool.description).toContain('untrusted');
    expect(conversationReadTool.description).not.toMatch(
      /documentId|hash|partId|projection|version/u,
    );
  });

  it('accepts direct search coordinates and defaults offset without weakening them', () => {
    expect(
      conversationSourceCoordinatesSchema.parse({
        chatId: CHAT_ID,
        messageSeq: 7,
        offset: 3,
        limit: 12,
      }),
    ).toEqual({ chatId: CHAT_ID, messageSeq: 7, offset: 3, limit: 12 });
    expect(
      conversationReadInputSchema.parse({ chatId: CHAT_ID, messageSeq: 7 }),
    ).toEqual({ chatId: CHAT_ID, messageSeq: 7, offset: 0 });
    expect(
      conversationReadInputSchema.parse({
        chatId: CHAT_ID,
        messageSeq: 7,
        offset: 3,
        limit: 12,
      }),
    ).toEqual({ chatId: CHAT_ID, messageSeq: 7, offset: 3, limit: 12 });
  });

  it.each([
    ['malformed UUID', { chatId: 'not-a-uuid' }],
    ['unknown property', { source: 'projection' }],
    ['zero sequence', { messageSeq: 0 }],
    ['negative sequence', { messageSeq: -1 }],
    ['fractional sequence', { messageSeq: 1.5 }],
    ['unsafe sequence', { messageSeq: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative offset', { offset: -1 }],
    ['fractional offset', { offset: 1.5 }],
    ['unsafe offset', { offset: Number.MAX_SAFE_INTEGER + 1 }],
    ['zero limit', { limit: 0 }],
    ['limit above maximum', { limit: 2001 }],
    ['fractional limit', { limit: 1.5 }],
    ['unsafe limit', { limit: Number.MAX_SAFE_INTEGER + 1 }],
  ])('rejects %s before source resolution', (_name, invalid) => {
    expect(() =>
      conversationReadInputSchema.parse({
        chatId: CHAT_ID,
        messageSeq: 7,
        ...invalid,
      }),
    ).toThrow(ZodError);
  });

  it('rejects invalid runtime input before calling the repository', async () => {
    const { db, find } = mockDb(lookup('not read'));
    const result = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
      unknown: true,
    });

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_input',
      message: 'The conversation read arguments are invalid.',
    });
    expect(find).not.toHaveBeenCalled();
  });
});

describe('conversation logical lines', () => {
  it('uses LF delimiters, treats CRLF as one delimiter, and keeps lone CR text', () => {
    expect(
      scanConversationLogicalLines('first\r\nsecond\rthird\nlast'),
    ).toEqual([
      {
        line: 0,
        text: 'first',
        delimiter: '\r\n',
        startOffset: 0,
        endOffsetExclusive: 5,
      },
      {
        line: 1,
        text: 'second\rthird',
        delimiter: '\n',
        startOffset: 7,
        endOffsetExclusive: 19,
      },
      {
        line: 2,
        text: 'last',
        delimiter: '',
        startOffset: 20,
        endOffsetExclusive: 24,
      },
    ]);
  });

  it('counts blanks and does not create a phantom terminal line', () => {
    expect(scanConversationLogicalLines('\n\n')).toEqual([
      {
        line: 0,
        text: '',
        delimiter: '\n',
        startOffset: 0,
        endOffsetExclusive: 0,
      },
      {
        line: 1,
        text: '',
        delimiter: '\n',
        startOffset: 1,
        endOffsetExclusive: 1,
      },
    ]);
    expect(scanConversationLogicalLines('')).toEqual([]);
  });
});

describe('conversation_read execution', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns exact eligible visible text with navigation metadata and closed framing', async () => {
    const source = lookup('unused', {
      role: 'user',
      parts: [
        { type: 'text', text: 'alpha' },
        { type: 'reasoning', text: 'excluded' },
        { type: 'text', text: 'beta' },
        { type: 'tool-result', output: 'excluded' },
      ],
      previousMessageSeq: 3,
      nextMessageSeq: 11,
    });
    const { db, find } = mockDb(source);

    const result = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
    });

    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(CHAT_ID, OWNER_ID, 7);
    expect(visibleMessageText(source.parts)).toBe('alpha\n\nbeta');
    expect(visibleMessageText(source.parts)).not.toContain('1: alpha');
    expect(result).toEqual({
      status: 'success',
      chatId: CHAT_ID,
      messageSeq: 7,
      role: 'user',
      timestamp: CREATED_AT.toISOString(),
      offset: 0,
      lineCount: 3,
      content: '1: alpha\n2: \n3: beta',
      previousMessageSeq: 3,
      nextMessageSeq: 11,
      notice: CONVERSATION_HISTORY_NOTICE,
    });
    expect(JSON.stringify(result)).not.toContain('excluded');
  });

  it('uses the same closed source error for misses and empty owners', async () => {
    const missing = mockDb(undefined);
    await expect(
      executeConversationRead(missing.db, OWNER_ID, {
        chatId: CHAT_ID,
        messageSeq: 7,
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'conversation_source_not_found',
      message: 'The conversation source was not found.',
    });
    expect(missing.find).toHaveBeenCalledTimes(1);

    const emptyOwner = mockDb(lookup('must not read'));
    emptyOwner.find.mockClear();
    await expect(
      executeConversationRead(emptyOwner.db, '  ', {
        chatId: CHAT_ID,
        messageSeq: 7,
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'conversation_source_not_found',
      message: 'The conversation source was not found.',
    });
    expect(emptyOwner.find).not.toHaveBeenCalled();
  });

  it('supports direct search coordinates and explicit continuation without a cut reason', async () => {
    const { db } = mockDb(lookup('one\ntwo\nthree\nfour'));
    await expect(
      executeConversationRead(db, OWNER_ID, {
        chatId: CHAT_ID,
        messageSeq: 7,
        offset: 1,
        limit: 2,
      }),
    ).resolves.toMatchObject({
      status: 'success',
      offset: 1,
      lineCount: 2,
      content: '2: two\n3: three\n',
      nextOffset: 3,
    });
    const result = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
      offset: 1,
      limit: 2,
    });
    expect(result).not.toHaveProperty('cutReason');
  });

  it('requests the remainder by default and reports an output cut when the serialized bound wins', async () => {
    const text = '\n'.repeat(2001);
    const { db } = mockDb(lookup(text));
    const result = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.lineCount).toBeLessThan(2000);
    expect(result.nextOffset).toBe(result.lineCount);
    expect(result.cutReason).toBe('output_limit');
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      CONVERSATION_READ_RESULT_MAX_CODE_UNITS,
    );

    const explicit = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
      limit: 2000,
    });
    expect(explicit.status).toBe('success');
    if (explicit.status !== 'success') return;
    expect(explicit.nextOffset).toBe(explicit.lineCount);
    expect(explicit.cutReason).toBe('output_limit');
  });

  it('uses the complete structured result budget and never generic-truncates success', async () => {
    const text = Array.from(
      { length: 400 },
      (_, index) => `${index.toString().padStart(3, '0')} ${'x'.repeat(70)}`,
    ).join('\n');
    const { db } = mockDb(lookup(text));
    const result = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
    });

    expect(result.status).toBe('success');
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      CONVERSATION_READ_RESULT_MAX_CODE_UNITS,
    );
    if (result.status !== 'success') return;
    expect(Number.isSafeInteger(result.nextOffset)).toBe(true);
    expect(result.cutReason).toBe('output_limit');
    expect(truncateOversizedResult(result)).toEqual(result);
  });

  it('selects an output-limited prefix with logarithmic candidate measurements', () => {
    const renderedLines = Array.from(
      { length: 2000 },
      (_, index) => `${index + 1}: ${'x'.repeat(50)}\n`,
    );
    const measurements: Array<number> = [];
    const selected = selectLargestConversationReadPrefix(2000, (lineCount) => {
      measurements.push(lineCount);
      const result: ConversationReadSuccess = {
        status: 'success',
        chatId: CHAT_ID,
        messageSeq: 7,
        role: 'assistant',
        timestamp: CREATED_AT.toISOString(),
        offset: 0,
        lineCount,
        content: renderedLines.slice(0, lineCount).join(''),
        notice: CONVERSATION_HISTORY_NOTICE,
      };
      return {
        result,
        fits:
          JSON.stringify(result).length <=
            CONVERSATION_READ_RESULT_MAX_CODE_UNITS &&
          JSON.stringify(neutralizeToolResult(result)).length <=
            CONVERSATION_READ_RESULT_MAX_CODE_UNITS,
      };
    });

    expect(selected?.lineCount).toBe(258);
    expect(measurements.length).toBeLessThan(32);
  });

  it('budgets both persisted and neutralized results without clipping reserved-tag lines', () => {
    const tagPair = '<system-reminder></system-reminder>'.repeat(17);
    const sourceText = Array.from({ length: 24 }, () => tagPair).join('\n');
    const source = lookup(sourceText);
    const sourceLines = scanConversationLogicalLines(sourceText);
    const fullContent = sourceLines
      .map((line) => `${line.line + 1}: ${line.text}${line.delimiter}`)
      .join('');
    const hypotheticalFull: ConversationReadSuccess = {
      status: 'success',
      chatId: source.chatId,
      messageSeq: source.seq,
      role: source.role,
      timestamp: source.createdAt.toISOString(),
      offset: 0,
      lineCount: sourceLines.length,
      content: fullContent,
      notice: CONVERSATION_HISTORY_NOTICE,
    };

    expect(JSON.stringify(hypotheticalFull).length).toBeLessThanOrEqual(
      CONVERSATION_READ_RESULT_MAX_CODE_UNITS,
    );
    expect(
      JSON.stringify(neutralizeToolResult(hypotheticalFull)).length,
    ).toBeGreaterThan(CONVERSATION_READ_RESULT_MAX_CODE_UNITS);

    const result = renderConversationRead(source, {
      chatId: CHAT_ID,
      messageSeq: 7,
      offset: 0,
      limit: sourceLines.length,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.lineCount).toBeLessThan(sourceLines.length);
    expect(result.nextOffset).toBe(result.lineCount);
    expect(result.cutReason).toBe('output_limit');
    expect(result.content).toBe(
      sourceLines
        .slice(0, result.lineCount)
        .map((line) => `${line.line + 1}: ${line.text}${line.delimiter}`)
        .join(''),
    );
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      CONVERSATION_READ_RESULT_MAX_CODE_UNITS,
    );
    const neutralized = neutralizeToolResult(result);
    expect(JSON.stringify(neutralized).length).toBeLessThanOrEqual(
      CONVERSATION_READ_RESULT_MAX_CODE_UNITS,
    );
    expect(result.content).toContain('<system-reminder>');
    expect(JSON.stringify(neutralized)).toContain('&lt;system-reminder&gt;');
    expect(JSON.stringify(neutralized)).not.toContain(
      '<system-reminder></system-reminder>',
    );
  });

  it('rejects a first logical line that cannot fit instead of clipping it', async () => {
    const { db } = mockDb(lookup('😀'.repeat(8000)));
    await expect(
      executeConversationRead(db, OWNER_ID, {
        chatId: CHAT_ID,
        messageSeq: 7,
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'conversation_limit_exceeded',
      message: 'The conversation read exceeded its output limit.',
    });
  });

  it('renders stored whitespace and blank lines exactly', async () => {
    const text = '  first  \n\nlast  ';
    const { db } = mockDb(lookup(text));
    const result = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
      offset: 0,
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.content).toBe('1:   first  \n2: \n3: last  ');
    expect(result.lineCount).toBe(3);
  });

  it('renders CRLF, lone CR text, and LF delimiters exactly', async () => {
    const { db } = mockDb(lookup('first\r\nsecond\rthird\nlast'));
    const result = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.content).toBe('1: first\r\n2: second\rthird\n3: last');
    expect(result.lineCount).toBe(3);
  });

  it('renders empty visible text at offset zero without continuation metadata', async () => {
    const { db } = mockDb(lookup('', { parts: [] }));
    const result = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
      offset: 0,
    });
    expect(result).toEqual({
      status: 'success',
      chatId: CHAT_ID,
      messageSeq: 7,
      role: 'assistant',
      timestamp: CREATED_AT.toISOString(),
      offset: 0,
      lineCount: 0,
      content: '',
      notice: CONVERSATION_HISTORY_NOTICE,
    });
    expect(result).not.toHaveProperty('nextOffset');
    expect(result).not.toHaveProperty('cutReason');
  });

  it.each([0, 1, 2, 3])(
    'rejects offset %i when it is outside a three-line message',
    async (offset) => {
      const { db } = mockDb(lookup('a\nb\nc'));
      const result = await executeConversationRead(db, OWNER_ID, {
        chatId: CHAT_ID,
        messageSeq: 7,
        offset: offset === 0 ? 3 : offset,
      });
      if (offset === 0) {
        expect(result).toEqual({
          status: 'error',
          type: 'conversation_range_invalid',
          message: 'The conversation line range is invalid.',
        });
      } else if (offset === 3) {
        expect(result).toEqual({
          status: 'error',
          type: 'conversation_range_invalid',
          message: 'The conversation line range is invalid.',
        });
      } else {
        expect(result.status).toBe('success');
      }
    },
  );

  it('rejects offsets beyond an empty message', async () => {
    const { db } = mockDb(lookup('', { parts: [] }));
    await expect(
      executeConversationRead(db, OWNER_ID, {
        chatId: CHAT_ID,
        messageSeq: 7,
        offset: 1,
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'conversation_range_invalid',
      message: 'The conversation line range is invalid.',
    });
  });
});

// The owner-scoped descriptor lookup runs against real Postgres in
// conversation-read-repository.integration.test.ts; these tests pin what
// `renderConversationRead` makes of the descriptors that lookup returned.
describe('conversation_read image placeholders', () => {
  const MEDIA_A = '01920000-0000-7000-8000-00000000000a';
  const MEDIA_B = '01920000-0000-7000-8000-00000000000b';
  const ARGS = { chatId: CHAT_ID, messageSeq: 7, offset: 0 };

  function filePart(id: string, filename?: string) {
    return {
      type: 'file',
      mediaType: 'image/png',
      url: `media://${id}`,
      ...(filename !== undefined && { filename }),
    };
  }

  function owned(
    ...descriptors: ReadonlyArray<MediaDescriptor>
  ): ReadonlyMap<string, MediaDescriptor> {
    return new Map(descriptors.map((d) => [d.id, d]));
  }

  const SHOT = descriptor(MEDIA_A, { name: 'shot.png' });
  const PLAN = descriptor(MEDIA_B, {
    name: 'plan.jpg',
    width: 800,
    height: 600,
  });

  it('follows the visible text with one placeholder line per file part in stored order', () => {
    const parts = [
      { type: 'text', text: 'look at these' },
      filePart(MEDIA_A, 'shot.png'),
      filePart(MEDIA_B, 'plan.jpg'),
    ];

    const result = renderConversationRead(
      lookup('unused', { role: 'user', parts }),
      ARGS,
      owned(SHOT, PLAN),
    );

    expect(result).toMatchObject({
      status: 'success',
      offset: 0,
      lineCount: 1,
      content: `1: look at these\n[image media://${MEDIA_A} shot.png 1600×900]\n[image media://${MEDIA_B} plan.jpg 800×600]\n`,
    });
    expect(result).not.toHaveProperty('nextOffset');
    expect(result).not.toHaveProperty('cutReason');
    // The shared visible-text view stays text-only: search reads it too.
    expect(visibleMessageText(parts)).toBe('look at these');
  });

  it('adds no LF before the placeholders when the last line is terminated', () => {
    const result = renderConversationRead(
      lookup('unused', {
        role: 'user',
        parts: [{ type: 'text', text: 'done\n' }, filePart(MEDIA_A)],
      }),
      ARGS,
      owned(SHOT),
    );

    expect(result).toMatchObject({
      lineCount: 1,
      content: `1: done\n[image media://${MEDIA_A} shot.png 1600×900]\n`,
    });
  });

  it('reads an image-only message as its placeholder line with zero lines', () => {
    const source = lookup('unused', {
      role: 'user',
      parts: [filePart(MEDIA_A)],
    });

    expect(renderConversationRead(source, ARGS, owned(SHOT))).toEqual({
      status: 'success',
      chatId: CHAT_ID,
      messageSeq: 7,
      role: 'user',
      timestamp: CREATED_AT.toISOString(),
      offset: 0,
      lineCount: 0,
      content: `[image media://${MEDIA_A} shot.png 1600×900]\n`,
      notice: CONVERSATION_HISTORY_NOTICE,
    });
    expect(
      renderConversationRead(source, { ...ARGS, offset: 1 }, owned(SHOT)),
    ).toEqual({
      status: 'error',
      type: 'conversation_range_invalid',
      message: 'The conversation line range is invalid.',
    });
  });

  it('carries the placeholders only on the read that reaches the end of the text', () => {
    const source = lookup('unused', {
      role: 'user',
      parts: [{ type: 'text', text: 'one\ntwo\nthree' }, filePart(MEDIA_A)],
    });

    const partial = renderConversationRead(
      source,
      { ...ARGS, limit: 2 },
      owned(SHOT),
    );
    expect(partial).toMatchObject({
      lineCount: 2,
      content: '1: one\n2: two\n',
      nextOffset: 2,
    });
    expect(JSON.stringify(partial)).not.toContain('media://');

    const rest = renderConversationRead(
      source,
      { ...ARGS, offset: 2 },
      owned(SHOT),
    );
    // The unterminated last line gets one LF before the placeholder line.
    expect(rest).toMatchObject({
      offset: 2,
      lineCount: 1,
      content: `3: three\n[image media://${MEDIA_A} shot.png 1600×900]\n`,
    });
    expect(rest).not.toHaveProperty('nextOffset');
  });

  it('renders a media id the owner lookup does not resolve as unavailable', () => {
    // Another owner's id is absent from the owner-scoped descriptor map.
    const result = renderConversationRead(
      lookup('unused', {
        role: 'user',
        parts: [{ type: 'text', text: 'see' }, filePart(MEDIA_A, 'shot.png')],
      }),
      ARGS,
      owned(),
    );

    expect(result).toMatchObject({
      lineCount: 1,
      content: `1: see\n[image media://${MEDIA_A} unavailable]\n`,
    });
    expect(JSON.stringify(result)).not.toContain('shot.png');
    expect(JSON.stringify(result)).not.toContain('1600');
  });

  it('reserves the placeholder lines inside the structured-result bound', () => {
    const rows = Array.from(
      { length: 400 },
      (_, index) => `${index.toString().padStart(3, '0')} ${'x'.repeat(70)}`,
    );
    const baseline = renderConversationRead(lookup(rows.join('\n')), ARGS);
    if (baseline.status !== 'success') expect.unreachable('expected success');
    expect(baseline.cutReason).toBe('output_limit');

    // Exactly as many lines as one complete text-only result can hold.
    const text = rows.slice(0, baseline.lineCount).join('\n');
    const textOnly = renderConversationRead(lookup(text), ARGS);
    expect(textOnly).toMatchObject({ lineCount: baseline.lineCount });
    expect(textOnly).not.toHaveProperty('nextOffset');

    const images = Array.from({ length: 10 }, (_, index) =>
      descriptor(
        `01920000-0000-7000-8000-${index.toString(16).padStart(12, '0')}`,
        { name: `${'n'.repeat(200)}-${index}.png` },
      ),
    );
    const source = lookup('unused', {
      role: 'user',
      parts: [{ type: 'text', text }, ...images.map((d) => filePart(d.id))],
    });
    const descriptors = owned(...images);

    const readAt = (offset: number): ConversationReadSuccess => {
      const read = renderConversationRead(
        source,
        { ...ARGS, offset },
        descriptors,
      );
      if (read.status !== 'success') expect.unreachable('expected success');
      return read;
    };
    const reads = [readAt(0)];
    let nextOffset = reads[0].nextOffset;
    while (nextOffset !== undefined) {
      const read = readAt(nextOffset);
      reads.push(read);
      nextOffset = read.nextOffset;
    }

    const first = reads[0];
    const last = reads.at(-1)!;
    expect(reads.length).toBeGreaterThan(1);
    expect(first.lineCount).toBeLessThan(baseline.lineCount);
    expect(first.nextOffset).toBe(first.lineCount);
    expect(first.cutReason).toBe('output_limit');
    for (const read of reads.slice(0, -1)) {
      expect(read.content).not.toContain('[image');
    }
    expect(
      last.content.endsWith(
        images.map((d) => `${barePlaceholder(d)}\n`).join(''),
      ),
    ).toBe(true);
    for (const read of reads) {
      expect(JSON.stringify(read).length).toBeLessThanOrEqual(
        CONVERSATION_READ_RESULT_MAX_CODE_UNITS,
      );
      expect(
        JSON.stringify(neutralizeToolResult(read)).length,
      ).toBeLessThanOrEqual(CONVERSATION_READ_RESULT_MAX_CODE_UNITS);
      expect(truncateOversizedResult(read)).toEqual(read);
    }
  });
});
