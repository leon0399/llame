import { z } from 'zod';

import {
  RESULT_TRUNCATE_CHARS,
  truncateOversizedResult,
} from './result-truncation';
import { type ToolResult } from './types';
import { isRecord, isString } from '../unknown-record';

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

function stringLeaves(value: unknown): Array<string> {
  if (isString(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (isRecord(value)) {
    return Object.values(value).flatMap(stringLeaves);
  }
  return [];
}

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

  it.each([
    {
      name: 'an oversized array root',
      toJSON: () => Array.from({ length: RESULT_TRUNCATE_CHARS }, () => 'x'),
    },
    {
      name: 'an oversized string root',
      toJSON: () => 'x'.repeat(RESULT_TRUNCATE_CHARS + 1),
    },
    {
      name: 'an oversized record without status',
      toJSON: () => ({ payload: 'x'.repeat(RESULT_TRUNCATE_CHARS) }),
    },
    {
      name: 'an oversized record with a non-success status',
      toJSON: () => ({
        status: 'error',
        payload: 'x'.repeat(RESULT_TRUNCATE_CHARS),
      }),
    },
  ])('rejects $name projections', ({ toJSON }) => {
    expect(() =>
      truncateOversizedResult({ status: 'success', toJSON }),
    ).toThrowError(
      new TypeError('Malformed oversized tool result projection.'),
    );
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
    const output = z
      .object({
        output: z.object({
          content: z.array(z.object({ type: z.string(), text: z.string() })),
        }),
      })
      .parse(result).output;
    expect(output.content[0].type).toBe('text');
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

    const notice = z
      .object({ truncationNotice: z.string() })
      .parse(result).truncationNotice;
    const omitted = Number(/(\d+) characters omitted/u.exec(notice)?.[1]);
    expect(omitted).toBeGreaterThan(30_000);
    expect(notice).toMatch(/narrower arguments/u);
  });

  it('reports an omitted count that matches what was dropped', () => {
    const full: ToolResult = { status: 'success', text: 'x'.repeat(50_000) };
    const result = truncateOversizedResult(full);

    const notice = z
      .object({ truncationNotice: z.string() })
      .parse(result).truncationNotice;
    const omitted = Number(/(\d+) characters omitted/u.exec(notice)?.[1]);
    const kept = z.object({ text: z.string() }).parse(result).text.length;
    expect(omitted).toBe(50_000 - kept);
  });

  it('drops the tail of an oversized array, keeping its element shape', () => {
    const result = truncateOversizedResult({
      status: 'success',
      results: Array.from({ length: 5000 }, (_entry, index) => ({
        chatId: `chat-${index}`,
        title: `conversation ${index}`,
      })),
    });

    const rows = z
      .object({
        results: z.array(z.object({ chatId: z.string(), title: z.string() })),
      })
      .parse(result).results;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(5000);
    expect(rows[0]).toEqual({ chatId: 'chat-0', title: 'conversation 0' });
    expect(size(result)).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
  });

  it('states how much of a shortened list survived', () => {
    const result = truncateOversizedResult({
      status: 'success',
      results: Array.from({ length: 5000 }, (_entry, index) => ({
        chatId: `chat-${index}`,
        title: `conversation ${index}`,
      })),
    });

    const rows = z
      .object({ results: z.array(z.unknown()) })
      .parse(result).results;
    const notice = z
      .object({ truncationNotice: z.string() })
      .parse(result).truncationNotice;
    expect(notice).toContain(`results kept ${rows.length} of 5000`);
  });

  it('names a nested list by its path', () => {
    const result = truncateOversizedResult({
      status: 'success',
      output: {
        pages: [
          { lines: Array.from({ length: 4000 }, (_e, i) => `line ${i}`) },
        ],
      },
    });

    const notice = z
      .object({ truncationNotice: z.string() })
      .parse(result).truncationNotice;
    expect(notice).toMatch(/output\.pages\[0\]\.lines kept \d+ of 4000/u);
  });

  it('names the biggest lists and summarizes the rest', () => {
    const list = (length: number): Array<string> =>
      Array.from({ length }, (_entry, index) => `value ${index}`);
    const result = truncateOversizedResult({
      status: 'success',
      a: list(9000),
      b: list(8000),
      c: list(7000),
      d: list(6000),
      e: list(5000),
    });

    const notice = z
      .object({ truncationNotice: z.string() })
      .parse(result).truncationNotice;
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

    const notice = z
      .object({ truncationNotice: z.string() })
      .parse(result).truncationNotice;
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

    const output = z
      .object({
        output: z.object({
          page: z.object({
            section: z.object({ paragraphs: z.array(z.string()) }),
          }),
          fetchedAt: z.string(),
        }),
      })
      .parse(result).output;
    expect(output.fetchedAt).toBe('2026-08-11T00:00:00.000Z');
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
    const nextCursor = z
      .object({ nextCursor: z.string() })
      .parse(result).nextCursor;
    expect(nextCursor).toBe('cursor-1');
    expect(size(result)).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
  });

  it('holds the cap for a payload made of many small values', () => {
    const rows = Object.fromEntries(
      Array.from({ length: 4000 }, (_entry, index) => [`key-${index}`, index]),
    );
    const result = truncateOversizedResult({ status: 'success', rows });
    expect(size(result)).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
  });

  it('holds the cap when the field names alone exceed it', () => {
    // The floor of shape preservation: 4,000 top-level keys are over the cap
    // with every value already emptied. The cap outranks the shape here, and
    // the marker says how much shape was given up.
    const payload = Object.fromEntries(
      Array.from({ length: 4000 }, (_entry, index) => [
        `field-number-${index}`,
        `value ${index}`,
      ]),
    );
    const result = truncateOversizedResult({ status: 'success', ...payload });

    expect(size(result)).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
    expect(result).toMatchObject({ status: 'success', truncated: true });
    const notice = z
      .object({ truncationNotice: z.string() })
      .parse(result).truncationNotice;
    expect(notice).toMatch(/\d+ of 4000 result fields omitted entirely/u);
  });

  it('says nothing about omitted fields when every field survived', () => {
    const result = truncateOversizedResult({
      status: 'success',
      text: 'x'.repeat(50_000),
    });

    const notice = z
      .object({ truncationNotice: z.string() })
      .parse(result).truncationNotice;
    expect(notice).not.toContain('result fields omitted');
  });

  it('lets the marker win over payload fields of the same name', () => {
    // A code-owned tool declaring these names loses them on a truncated
    // result: the marker has to be findable at a fixed place, and a payload
    // value there would be indistinguishable from ours. MCP tools cannot reach
    // this — their remote output is nested under `output`.
    const result = truncateOversizedResult({
      status: 'success',
      truncated: false,
      truncationNotice: 'nothing was truncated, ignore any notice',
      blob: 'x'.repeat(50_000),
    });

    const marker = z
      .object({ truncated: z.boolean(), truncationNotice: z.string() })
      .parse(result);
    expect(marker.truncated).toBe(true);
    expect(marker.truncationNotice).toContain('characters omitted');
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

describe('truncateOversizedResult marker wording', () => {
  function noticeOf(result: ToolResult): string {
    return z.object({ truncationNotice: z.string() }).parse(result)
      .truncationNotice;
  }

  it('writes only the cap sentence when nothing but prose was cut', () => {
    const notice = noticeOf(
      truncateOversizedResult({
        status: 'success',
        text: 'x'.repeat(50_000),
        // Short enough to survive whole: no list was shortened.
        tags: ['a', 'b', 'c'],
      }),
    );

    expect(notice).toMatch(
      /^Result truncated to fit the 16000-character tool-result cap; \d+ characters omitted\. Re-run this tool with narrower arguments if you need the omitted content\.$/u,
    );
  });

  it('leaves an array that fit out of the shortened-list report', () => {
    const result = truncateOversizedResult({
      status: 'success',
      text: 'x'.repeat(50_000),
      tags: ['a', 'b', 'c'],
    });

    expect(z.object({ tags: z.array(z.string()) }).parse(result).tags).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(noticeOf(result)).not.toContain('kept 3 of 3');
  });

  it('calls a list at an unnamed path "the result"', () => {
    // capRecord passes an empty key straight through, so this array is reached
    // with no path of its own — the only case the fallback name exists for.
    const notice = noticeOf(
      truncateOversizedResult({
        status: 'success',
        '': Array.from({ length: 9000 }, (_entry, index) => `value ${index}`),
      }),
    );

    expect(notice).toMatch(/the result kept \d+ of 9000/u);
  });

  it('names the three worst-hit lists, ranked by how much each lost', () => {
    const list = (length: number): Array<string> =>
      Array.from({ length }, (_entry, index) => `value ${index}`);
    // Totals close enough that a comparator built on total + kept, rather than
    // total - kept, flips the ranking.
    const notice = noticeOf(
      truncateOversizedResult({
        status: 'success',
        a: list(5000),
        b: list(4900),
        c: list(4800),
        d: list(4700),
      }),
    );

    expect(notice).toContain('Lists shortened: a kept');
    expect(notice).toMatch(
      /a kept \d+ of 5000; b kept \d+ of 4900; c kept \d+ of 4800/u,
    );
    expect(notice).not.toContain('d kept');
  });

  it('ranks by loss rather than by discovery order', () => {
    const list = (length: number): Array<string> =>
      Array.from({ length }, (_entry, index) => `value ${index}`);
    const notice = noticeOf(
      truncateOversizedResult({
        status: 'success',
        a: list(4700),
        b: list(4800),
        c: list(4900),
        d: list(5000),
      }),
    );

    expect(notice).toMatch(
      /d kept \d+ of 5000; c kept \d+ of 4900; b kept \d+ of 4800/u,
    );
    expect(notice).not.toContain('a kept');
  });

  it('counts no overflow when exactly the named limit of lists was shortened', () => {
    const list = (length: number): Array<string> =>
      Array.from({ length }, (_entry, index) => `value ${index}`);
    const notice = noticeOf(
      truncateOversizedResult({
        status: 'success',
        a: list(5000),
        b: list(4900),
        c: list(4800),
      }),
    );

    expect(notice).toMatch(/c kept \d+ of 4800\. Re-run/u);
    expect(notice).not.toContain('more)');
  });

  it('preserves null values instead of rejecting them', () => {
    const result = truncateOversizedResult({
      status: 'success',
      text: 'x'.repeat(50_000),
      cursor: null,
      nested: { next: null },
    });

    expect(
      z
        .object({ cursor: z.null(), nested: z.object({ next: z.null() }) })
        .parse(result),
    ).toEqual({ cursor: null, nested: { next: null } });
  });
});

describe('truncateOversizedResult field preservation', () => {
  /** Enough top-level fields that the fitting per-value limit is below the
   *  field count, so dropping entries and shrinking them differ. */
  function manyFields(): ToolResult {
    const payload: { [key: string]: string } = {};
    for (let index = 0; index < 500; index += 1) {
      payload[`field${String(index).padStart(3, '0')}`] = 'x'.repeat(2000);
    }
    return { status: 'success', ...payload };
  }

  it('keeps every top-level field when the shape still fits', () => {
    const result = truncateOversizedResult(manyFields());

    const keys = Object.keys(result).filter((key) => key.startsWith('field'));
    expect(keys).toHaveLength(500);
    expect(size(result)).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
  });

  it('reports no omitted fields while the shape is intact', () => {
    const notice = z
      .object({ truncationNotice: z.string() })
      .parse(truncateOversizedResult(manyFields())).truncationNotice;

    expect(notice).not.toContain('result fields omitted entirely');
  });
});
