import { drizzle } from 'drizzle-orm/postgres-js';
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';
import { describe, expect, it, vi } from 'vitest';
import {
  ChatReadRepository,
  type ChatIndexRow,
} from '../chats/chat-read-repository';
import { readChatIndex } from './chat-read-index';
import type { ToolResult } from './types';

const CHAT_ID = '00000000-0000-0000-0000-000000000001';

function content(result: ToolResult): string {
  if (result.status !== 'success' || !isString(result.content))
    throw new Error('Expected a successful chat index');

  return result.content;
}

function row(seq: number): ChatIndexRow {
  return {
    seq,
    role: seq % 2 ? 'user' : 'assistant',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    parts: [{ type: 'text', text: `eligible-${seq}` }],
  };
}

function repository(rows: Array<ChatIndexRow>, ownsChat = true) {
  const repo = new ChatReadRepository(drizzle.mock());

  vi.spyOn(repo, 'maxCommittedSequence').mockResolvedValue(
    rows.at(-1)?.seq ?? 0,
  );
  vi.spyOn(repo, 'currentRunStatus').mockResolvedValue('idle');
  vi.spyOn(repo, 'ownsChat').mockResolvedValue(ownsChat);
  vi.spyOn(repo, 'listEligibleIndex').mockImplementation(
    (_chatId, _owner, window) => {
      const matches = rows.filter(
        ({ seq }) =>
          seq >= (window.start ?? 0) &&
          seq <= (window.end ?? Number.MAX_SAFE_INTEGER) &&
          (window.beforeSeq === undefined || seq < window.beforeSeq),
      );

      return Promise.resolve(
        window.beforeSeq === undefined
          ? matches.slice(0, window.limit)
          : matches.slice(-window.limit),
      );
    },
  );
  vi.spyOn(repo, 'previousEligibleSequences').mockImplementation(
    (_chatId, _owner, beforeSeq, limit) =>
      Promise.resolve(
        rows
          .filter(({ seq }) => seq < beforeSeq)
          .slice(-limit)
          .toReversed()
          .map(({ seq }) => ({ seq })),
      ),
  );

  return repo;
}

function read(repo: ChatReadRepository, selector?: string) {
  return readChatIndex({
    repository: repo,
    owner: 'owner',
    chatId: CHAT_ID,
    path: `chat://${CHAT_ID}`,
    selector,
  });
}

describe('readChatIndex selection boundaries', () => {
  it('defaults to the newest eligible rows while an explicit range starts at its oldest bound', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => row(index * 3 + 1));
    const repo = repository(rows);

    const newest = await read(repo);
    const oldest = await read(repo, 'M1-178');

    expect(newest).toMatchObject({
      status: 'success',
      shownSeqRange: { startSeq: 31, endSeq: 178 },
      truncated: true,
      earlierLocator: `chat://${CHAT_ID}:M1-30`,
    });
    expect(content(newest)).toContain('eligible-31');
    expect(content(newest)).toContain('eligible-178');
    expect(content(newest)).not.toContain('eligible-28');
    expect(oldest).toMatchObject({
      status: 'success',
      shownSeqRange: { startSeq: 1, endSeq: 148 },
      truncated: true,
      continuationLocator: `chat://${CHAT_ID}:M149-178`,
    });
    expect(content(oldest)).toContain('eligible-1');
    expect(content(oldest)).toContain('eligible-148');
    expect(content(oldest)).not.toContain('eligible-151');
  });

  it('builds continuation from the visible eligible boundary after result fitting', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => row(index * 2 + 1));

    for (const eligible of rows)
      eligible.parts = [
        { type: 'text', text: `eligible-${eligible.seq} ${'🙂'.repeat(200)}` },
      ];
    const result = await read(repository(rows), 'M1-119');

    const range =
      result.status === 'success' ? result.shownSeqRange : undefined;

    if (!isRecord(range) || !isNumber(range.endSeq))
      throw new Error('Expected an index sequence range');

    const endSeq = range.endSeq;

    expect(endSeq).toBeLessThan(99);
    expect(result).toMatchObject({
      status: 'success',
      truncated: true,
      continuationLocator: `chat://${CHAT_ID}:M${endSeq + 1}-119`,
    });
    expect(content(result)).toContain(`eligible-${endSeq}`);
    expect(content(result)).not.toContain(`eligible-${endSeq + 2}`);
  });
  it('recomputes the earlier locator when result fitting removes oldest visible rows', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => row(index * 3 + 1));

    for (const eligible of rows)
      eligible.parts = [
        { type: 'text', text: `eligible-${eligible.seq} ${'🙂'.repeat(200)}` },
      ];
    const result = await read(repository(rows));

    const range =
      result.status === 'success' ? result.shownSeqRange : undefined;

    if (!isRecord(range) || !isNumber(range.startSeq))
      throw new Error('Expected an index sequence range');

    const startSeq = range.startSeq;

    expect(startSeq).toBeGreaterThan(31);
    expect(result).toMatchObject({
      status: 'success',
      truncated: true,
      earlierLocator: `chat://${CHAT_ID}:M1-${startSeq - 1}`,
    });
    expect(content(result)).toContain(`eligible-${startSeq}`);
  });

  it('distinguishes an empty owned chat from a chat not owned by the caller', async () => {
    const owned = await read(repository([]));
    const notOwned = await read(repository([], false));

    expect(owned).toMatchObject({
      status: 'success',
      kind: 'chat-index',
      content: '',
      shownSeqRange: null,
      truncated: false,
    });
    expect(notOwned).toMatchObject({
      status: 'error',
      type: 'not_found',
    });
  });
});
