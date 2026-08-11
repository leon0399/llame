import {
  cutStringAtCodePointBoundary,
  RESULT_TRUNCATE_CHARS,
  truncateOversizedResult,
} from './result-truncation';
import { type ToolResult } from './types';

function size(result: ToolResult): number {
  return JSON.stringify(result).length;
}

/**
 * `String.prototype.isWellFormed` is ES2024, above this package's configured
 * lib. A unicode-mode pattern matches whole code points, so a paired surrogate
 * never enters this range and only an unpaired one does.
 */
const LONE_SURROGATE_PATTERN = /[\uD800-\uDFFF]/u;

function isWellFormed(value: string): boolean {
  return !LONE_SURROGATE_PATTERN.test(value);
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(stringLeaves);
  }
  return [];
}

describe('cutStringAtCodePointBoundary', () => {
  const grin = '\u{1F600}'; // one code point, two UTF-16 code units

  it('steps back a unit when the cut splits a surrogate pair', () => {
    const cut = cutStringAtCodePointBoundary(`${grin}${grin}`, 3);
    expect(cut).toBe(grin);
    expect(isWellFormed(cut)).toBe(true);
  });

  it('keeps a pair the cut lands exactly after', () => {
    expect(cutStringAtCodePointBoundary(`${grin}${grin}`, 2)).toBe(grin);
  });

  it('cuts plain text at the limit and leaves short values alone', () => {
    expect(cutStringAtCodePointBoundary('abcdef', 3)).toBe('abc');
    expect(cutStringAtCodePointBoundary('ab', 5)).toBe('ab');
    expect(cutStringAtCodePointBoundary('ab', 0)).toBe('');
  });

  it('does not step back for a BMP character before the cut', () => {
    // `é` is a single code unit, not a surrogate — the guard must not fire.
    expect(cutStringAtCodePointBoundary(`aé${grin}`, 2)).toBe('aé');
  });
});

describe('truncateOversizedResult', () => {
  it('returns a result under the cap untouched', () => {
    const result: ToolResult = { status: 'success', rows: [{ id: 'a' }] };
    expect(truncateOversizedResult(result)).toBe(result);
  });

  it('never truncates an error result', () => {
    const result: ToolResult = {
      status: 'error',
      type: 'execution_failed',
      message: 'x'.repeat(RESULT_TRUNCATE_CHARS * 2),
    };
    expect(truncateOversizedResult(result)).toBe(result);
  });

  it('keeps the status and every declared field of a truncated result', () => {
    const result = truncateOversizedResult({
      status: 'success',
      query: 'weather',
      total: 3,
      output: { content: [{ type: 'text', text: 'x'.repeat(60_000) }] },
    });

    expect(result.status).toBe('success');
    expect(result).toMatchObject({
      query: 'weather',
      total: 3,
      truncated: true,
    });
    // The declared shape survives: `output.content[0]` is still an object with
    // its own `type`/`text`, not a fragment of the result's serialization.
    const output = (result as Record<string, unknown>).output as {
      content: { type: string; text: string }[];
    };
    expect(output.content[0].type).toBe('text');
    expect(typeof output.content[0].text).toBe('string');
    expect(output.content[0].text.length).toBeLessThan(60_000);
    expect(size(result)).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
  });

  it('cuts strings on a code-point boundary', () => {
    // Every cut offset lands mid-pair for at least one of these two payloads,
    // because the emoji run starts at an odd offset in the second.
    for (const prefix of ['', 'a']) {
      const result = truncateOversizedResult({
        status: 'success',
        text: `${prefix}${'\u{1F600}'.repeat(40_000)}`,
      });
      for (const leaf of stringLeaves(result)) {
        expect(isWellFormed(leaf)).toBe(true);
      }
      expect(size(result)).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
    }
  });

  it('states the omitted amount and a recovery action', () => {
    const result = truncateOversizedResult({
      status: 'success',
      text: 'x'.repeat(50_000),
    });

    const notice = (result as Record<string, unknown>)
      .truncationNotice as string;
    const omitted = Number(/(\d+) characters omitted/u.exec(notice)?.[1]);
    expect(omitted).toBeGreaterThan(30_000);
    expect(notice).toMatch(/narrower arguments/u);
  });

  it('reports an omitted count that matches what was dropped', () => {
    const full: ToolResult = { status: 'success', text: 'x'.repeat(50_000) };
    const result = truncateOversizedResult(full);

    const notice = (result as Record<string, unknown>)
      .truncationNotice as string;
    const omitted = Number(/(\d+) characters omitted/u.exec(notice)?.[1]);
    const kept = ((result as Record<string, unknown>).text as string).length;
    expect(omitted).toBe(50_000 - kept);
  });

  it('drops the tail of an oversized array, keeping its element shape', () => {
    const result = truncateOversizedResult({
      status: 'success',
      results: Array.from({ length: 5_000 }, (_entry, index) => ({
        chatId: `chat-${index}`,
        title: `conversation ${index}`,
      })),
    });

    const rows = (result as Record<string, unknown>).results as {
      chatId: string;
      title: string;
    }[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(5_000);
    expect(rows[0]).toEqual({ chatId: 'chat-0', title: 'conversation 0' });
    expect(size(result)).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
  });

  it('states how much of a shortened list survived', () => {
    const result = truncateOversizedResult({
      status: 'success',
      results: Array.from({ length: 5_000 }, (_entry, index) => ({
        chatId: `chat-${index}`,
        title: `conversation ${index}`,
      })),
    });

    const rows = (result as Record<string, unknown>).results as unknown[];
    const notice = (result as Record<string, unknown>)
      .truncationNotice as string;
    expect(notice).toContain(`results kept ${rows.length} of 5000`);
  });

  it('names a nested list by its path', () => {
    const result = truncateOversizedResult({
      status: 'success',
      output: {
        pages: [
          { lines: Array.from({ length: 4_000 }, (_e, i) => `line ${i}`) },
        ],
      },
    });

    const notice = (result as Record<string, unknown>)
      .truncationNotice as string;
    expect(notice).toMatch(/output\.pages\[0\]\.lines kept \d+ of 4000/u);
  });

  it('names the biggest lists and summarizes the rest', () => {
    const list = (length: number): string[] =>
      Array.from({ length }, (_entry, index) => `value ${index}`);
    const result = truncateOversizedResult({
      status: 'success',
      a: list(9_000),
      b: list(8_000),
      c: list(7_000),
      d: list(6_000),
      e: list(5_000),
    });

    const notice = (result as Record<string, unknown>)
      .truncationNotice as string;
    // Ranked by how much each list lost, then the tail is counted, not named.
    expect(notice).toMatch(/Lists shortened: a kept \d+ of 9000; b kept/u);
    expect(notice).toContain('(and 2 more)');
    expect(notice).not.toContain('e kept');
    expect(size(result)).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
  });

  it('says nothing about lists when none were shortened', () => {
    const result = truncateOversizedResult({
      status: 'success',
      text: 'x'.repeat(50_000),
    });

    const notice = (result as Record<string, unknown>)
      .truncationNotice as string;
    expect(notice).not.toContain('Lists shortened');
  });

  it('shrinks a deeply nested payload without flattening it', () => {
    const result = truncateOversizedResult({
      status: 'success',
      output: {
        page: { section: { paragraphs: ['y'.repeat(80_000)] } },
        fetchedAt: '2026-08-11T00:00:00.000Z',
      },
    });

    const output = (result as Record<string, unknown>).output as {
      page: { section: { paragraphs: string[] } };
      fetchedAt: string;
    };
    expect(output.fetchedAt).toBe('2026-08-11T00:00:00.000Z');
    expect(typeof output.page.section.paragraphs[0]).toBe('string');
    expect(size(result)).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
  });

  it('keeps every top-level field even when one field dominates', () => {
    const result = truncateOversizedResult({
      status: 'success',
      query: 'q',
      blob: 'z'.repeat(200_000),
      nextCursor: 'cursor-1',
    });

    expect(Object.keys(result)).toEqual(
      expect.arrayContaining(['status', 'query', 'blob', 'nextCursor']),
    );
    expect((result as Record<string, unknown>).nextCursor).toBe('cursor-1');
    expect(size(result)).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
  });

  it('holds the cap for a payload made of many small values', () => {
    const rows = Object.fromEntries(
      Array.from({ length: 4_000 }, (_entry, index) => [`key-${index}`, index]),
    );
    const result = truncateOversizedResult({ status: 'success', rows });
    expect(size(result)).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
  });

  it('truncates a result exactly one character over the cap', () => {
    const overhead = JSON.stringify({ status: 'success', value: '' }).length;
    const result = truncateOversizedResult({
      status: 'success',
      value: 'x'.repeat(RESULT_TRUNCATE_CHARS + 1 - overhead),
    });

    expect(result).toMatchObject({ status: 'success', truncated: true });
    expect(size(result)).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
  });
});
