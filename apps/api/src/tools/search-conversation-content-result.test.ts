import { describe, expect, it } from 'vitest';
import type { CanonicalSearchMessage } from '../search/chat/canonical-search-matcher';
import type { HybridSearchResult } from '../search/core';
import { buildSearchConversationsContentResult } from './search-conversation-content-result';

const CHAT_ID = '00000000-0000-4000-8000-000000000001';

const ROW: HybridSearchResult = {
  id: CHAT_ID,
  title: 'Search evidence',
  snippet: null,
  updatedAt: new Date('2026-11-23T00:00:00Z'),
  bestDocumentId: null,
};

function result(text: string, start: number, end: number) {
  const source: CanonicalSearchMessage = {
    messageSeq: 7,
    role: 'assistant',
    timestamp: new Date('2026-11-22T00:00:00Z'),
    visibleText: text,
    sourceStart: start,
    sourceEndExclusive: end,
  };

  return buildSearchConversationsContentResult(ROW, source);
}

describe('vector search evidence locators', () => {
  it('does not include the next logical line at an exclusive span end', () => {
    expect(result('alpha\r\nbeta\r\ngamma', 7, 13)).toMatchObject({
      locator: `chat://${CHAT_ID}/7:L2-2`,
      excerpt: 'beta\r\n',
      role: 'assistant',
      messageSeq: 7,
    });
  });

  it('keeps delimiter-only spans on their source line and includes following text when selected', () => {
    expect(result('a\r\nb', 2, 3)).toMatchObject({
      locator: `chat://${CHAT_ID}/7:L1-1`,
      excerpt: '\n',
    });
    expect(result('a\r\nb', 2, 4)).toMatchObject({
      locator: `chat://${CHAT_ID}/7:L1-2`,
      excerpt: '\nb',
    });
  });

  it('addresses the final logical line for an empty end-of-message span', () => {
    const text = 'first\nsecond\nlast';
    expect(result(text, text.length, text.length)).toMatchObject({
      locator: `chat://${CHAT_ID}/7:L3-3`,
      excerpt: '',
    });
  });

  it('keeps a complete 500-code-point excerpt without a truncation marker', () => {
    const text = '😀'.repeat(500);
    expect(result(text, 0, text.length)?.excerpt).toBe(text);
  });

  it('caps a longer excerpt by code point and marks the omitted suffix', () => {
    const text = `${'😀'.repeat(500)}discarded suffix`;
    expect(result(text, 0, text.length)?.excerpt).toBe(`${'😀'.repeat(500)}…`);
  });
});
