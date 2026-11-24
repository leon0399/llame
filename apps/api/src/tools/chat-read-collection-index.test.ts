import { afterEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { isString } from '@workspace/runtime-safety';
import { measureToolResultForModel } from './model-text';
import {
  ChatReadRepository,
  type ChatIndexRow,
  type ChatReadRow,
} from '../chats/chat-read-repository';
import { readChatCollection } from './chat-read-collection';
import { readChatIndex } from './chat-read-index';
import type { ToolResult } from './types';

afterEach(() => vi.restoreAllMocks());

const CHAT_ID = '00000000-0000-0000-0000-000000000001';

function content(result: ToolResult): string {
  if (result.status !== 'success' || !isString(result.content))
    throw new Error('Expected a successful text read');

  return result.content;
}

function collectionRow(index: number): ChatReadRow {
  return {
    chatId: `chat-${index}`,
    locator: `chat://chat-${index}`,
    title: `Title ${index}`,
    activityAt: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    messageCount: index,
    workspace: '/workspace',
    runStatus: index === 2 ? 'running_model' : 'idle',
  };
}

function collectionRepository(rows: Array<ChatReadRow>, total = rows.length) {
  const repository = new ChatReadRepository(drizzle.mock());

  const readChatRows = vi
    .spyOn(repository, 'readChatRows')
    .mockImplementation((_owner, offset, limit) =>
      Promise.resolve({
        rows: rows.slice(offset, offset + limit),
        total,
      }),
    );

  const countOwnedChats = vi
    .spyOn(repository, 'countOwnedChats')
    .mockResolvedValue(total);

  return { repository, readChatRows, countOwnedChats };
}

describe('readChatCollection boundaries', () => {
  it('caps unselected pages at 20 and reports the full count, shown range, and continuation', async () => {
    const rows = Array.from({ length: 24 }, (_, index) =>
      collectionRow(index + 1),
    );

    const fixture = collectionRepository(rows, 24);

    const result = await readChatCollection(fixture.repository, 'owner');

    expect(result).toMatchObject({
      status: 'success',
      kind: 'directory',
      entryCount: 24,
      shownRange: { startLine: 1, endLine: 20 },
      nextOffset: 20,
      truncated: true,
    });
    expect(content(result)).toContain('Title 1');
    expect(content(result)).toContain('Title 20');
    expect(content(result)).not.toContain('Title 21');
  });

  it('honors a selected range within the page cap and stops at its requested end', async () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      collectionRow(index + 1),
    );

    const fixture = collectionRepository(rows, 10);

    const result = await readChatCollection(
      fixture.repository,
      'owner',
      'L3-5',
    );

    expect(result).toMatchObject({
      status: 'success',
      entryCount: 10,
      requestedRange: { startLine: 3, endLine: 5 },
      shownRange: { startLine: 3, endLine: 5 },
      truncated: false,
    });
    expect(content(result)).toContain('Title 3');
    expect(content(result)).toContain('Title 5');
    expect(content(result)).not.toContain('Title 6');
  });

  it('bounds returned collection rows even when the repository over-returns', async () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      collectionRow(index + 1),
    );

    const fixture = collectionRepository(rows, 25);
    fixture.readChatRows.mockResolvedValue({ rows, total: 25 });

    const result = await readChatCollection(fixture.repository, 'owner');

    expect(result).toMatchObject({
      status: 'success',
      shownRange: { startLine: 1, endLine: 20 },
      nextOffset: 20,
      truncated: true,
    });
    expect(content(result)).toContain('Title 20');
    expect(content(result)).not.toContain('Title 21');
  });

  it('fits collection rows under the model result bound and marks omitted rows as continuation', async () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      ...collectionRow(index + 1),
      title: 'x'.repeat(1200),
    }));

    const fixture = collectionRepository(rows, 20);

    const result = await readChatCollection(fixture.repository, 'owner');

    expect(result).toMatchObject({ status: 'success', truncated: true });
    expect(measureToolResultForModel('read')(result)).toBeLessThanOrEqual(
      16_000,
    );

    if (result.status !== 'success')
      throw new Error('Expected a successful collection.');
    expect(result.shownRange).toEqual({
      startLine: 1,
      endLine: result.nextOffset,
    });
    expect(result.nextOffset).toBeLessThan(20);
  });

  it('preserves per-row run status in the returned collection entry', async () => {
    const fixture = collectionRepository([collectionRow(2)]);

    const result = await readChatCollection(fixture.repository, 'owner');

    expect(content(result)).toContain('running_model');
  });
});

function indexRow(
  seq: number,
  parts: Array<unknown> = [{ type: 'text', text: `message ${seq}` }],
): ChatIndexRow {
  return {
    seq,
    role: seq % 2 ? 'user' : 'assistant',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    parts,
  };
}

function indexRepository(
  rows: Array<ChatIndexRow>,
  latest = rows.at(-1)?.seq ?? 0,
) {
  const repository = new ChatReadRepository(drizzle.mock());

  const listEligibleIndex = vi
    .spyOn(repository, 'listEligibleIndex')
    .mockImplementation((_chatId, _owner, window) => {
      const matches = rows.filter(
        (row) =>
          row.seq >= (window.start ?? 0) &&
          row.seq <= (window.end ?? Number.MAX_SAFE_INTEGER) &&
          (window.beforeSeq === undefined || row.seq < window.beforeSeq),
      );

      return Promise.resolve(
        window.beforeSeq === undefined
          ? matches.slice(0, window.limit)
          : matches.slice(-window.limit),
      );
    });

  const previousEligibleSequences = vi
    .spyOn(repository, 'previousEligibleSequences')
    .mockImplementation((_chatId, _owner, beforeSeq, limit) =>
      Promise.resolve(
        rows
          .filter((row) => row.seq < beforeSeq)
          .slice(-limit)
          .toReversed()
          .map(({ seq }) => ({ seq })),
      ),
    );

  vi.spyOn(repository, 'maxCommittedSequence').mockResolvedValue(latest);
  vi.spyOn(repository, 'currentRunStatus').mockResolvedValue('awaiting_jobs');
  vi.spyOn(repository, 'ownsChat').mockResolvedValue(true);

  return { repository, listEligibleIndex, previousEligibleSequences };
}

describe('readChatIndex boundaries', () => {
  it('keeps the newest 50 default rows and exposes the immediately preceding visible-message window', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => index + 1).map(
      (seq) => indexRow(seq),
    );

    const fixture = indexRepository(rows);

    const result = await readChatIndex({
      repository: fixture.repository,
      owner: 'owner',
      chatId: CHAT_ID,
      path: `chat://${CHAT_ID}`,
    });

    expect(result).toMatchObject({
      status: 'success',
      runStatus: 'awaiting_jobs',
      shownSeqRange: { startSeq: 11, endSeq: 60 },
      truncated: true,
      earlierLocator: `chat://${CHAT_ID}:M1-10`,
    });
    expect(content(result)).toContain('message 11');
    expect(content(result)).toContain('message 60');
    expect(content(result)).not.toContain('message 10');
  });

  it('returns the requested explicit window and continuation without exceeding its end', async () => {
    const rows = Array.from({ length: 70 }, (_, index) => indexRow(index + 1));
    const fixture = indexRepository(rows);

    const result = await readChatIndex({
      repository: fixture.repository,
      owner: 'owner',
      chatId: CHAT_ID,
      path: `chat://${CHAT_ID}`,
      selector: 'M5-70',
    });

    expect(result).toMatchObject({
      status: 'success',
      shownSeqRange: { startSeq: 5, endSeq: 54 },
      truncated: true,
      continuationLocator: `chat://${CHAT_ID}:M55-70`,
    });
    expect(content(result)).toContain('message 5');
    expect(content(result)).toContain('message 54');
    expect(content(result)).not.toContain('message 55');
  });

  it('does not expose hidden-only text as an index preview', async () => {
    const fixture = indexRepository([
      indexRow(1, [{ type: 'reasoning', text: 'hidden secret' }]),
    ]);

    const result = await readChatIndex({
      repository: fixture.repository,
      owner: 'owner',
      chatId: CHAT_ID,
      path: `chat://${CHAT_ID}`,
    });

    expect(content(result)).not.toContain('hidden secret');
  });
});
