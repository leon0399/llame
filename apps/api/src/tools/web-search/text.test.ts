import { describe, expect, it } from 'vitest';

import { type ToolResult } from '../types';
import {
  renderWebSearchOutput,
  renderWebSearchText,
  webSearchOutputSchema,
} from './text';

/** Three ranked results, the second without a snippet or a date. */
const threeResults: ToolResult = {
  status: 'success',
  kind: 'results',
  engine: 'brave',
  query: 'deployment decision',
  results: [
    {
      title: 'First',
      url: 'https://a.example/one',
      snippet: 'First snippet.',
      published: '2026-10-08',
    },
    { title: 'Second', url: 'https://b.example/two' },
    {
      title: 'Third',
      url: 'https://c.example/three',
      snippet: 'Third snippet.',
    },
  ],
};

describe('the web search text shape', () => {
  it('renders three results in rank order, each URL on its own line', () => {
    expect(renderWebSearchText(threeResults)).toBe(
      [
        '[engine: brave; query: deployment decision]',
        '## 1. First',
        'https://a.example/one',
        'a.example · 2026-10-08',
        '> First snippet.',
        '',
        '## 2. Second',
        'https://b.example/two',
        'b.example',
        '',
        '## 3. Third',
        'https://c.example/three',
        'c.example',
        '> Third snippet.',
      ].join('\n'),
    );
  });

  it('gives every result and answer block its artifact line range', () => {
    const rendered = renderWebSearchOutput(
      webSearchOutputSchema.parse(threeResults),
    );

    expect(rendered?.blocks).toEqual([
      {
        locators: ['https://a.example/one'],
        start: 2,
        end: 5,
        text: [
          '## 1. First',
          'https://a.example/one',
          'a.example · 2026-10-08',
          '> First snippet.',
        ].join('\n'),
      },
      {
        locators: ['https://b.example/two'],
        start: 7,
        end: 9,
        text: ['## 2. Second', 'https://b.example/two', 'b.example'].join('\n'),
      },
      {
        locators: ['https://c.example/three'],
        start: 11,
        end: 14,
        text: [
          '## 3. Third',
          'https://c.example/three',
          'c.example',
          '> Third snippet.',
        ].join('\n'),
      },
    ]);
  });

  it('renders an aggregate answer after the fifth result with its citations', () => {
    const results = [1, 2, 3, 4, 5].map((rank) => ({
      title: `Result ${rank}`,
      url: `https://r${rank}.example/page`,
      snippet: `Snippet ${rank}.`,
    }));

    const text = renderWebSearchText({
      status: 'success',
      kind: 'results',
      engine: 'broad',
      query: 'what changed',
      notes: ['exa: rate_limited'],
      results,
      answers: [
        {
          engine: 'claude-search',
          answer: 'Grounded.',
          citations: [
            { url: 'https://r1.example/page' },
            { url: 'https://r2.example/page' },
          ],
        },
      ],
    });

    expect(text).toBe(
      [
        '[engine: broad; query: what changed]',
        ...results.flatMap((result, index) => [
          `## ${index + 1}. ${result.title}`,
          result.url,
          `r${index + 1}.example`,
          `> ${result.snippet}`,
          '',
        ]),
        '## Answer (claude-search)',
        '> Grounded.',
        '[1] https://r1.example/page',
        '[2] https://r2.example/page',
        '[exa: rate_limited]',
      ].join('\n'),
    );
  });

  it('quotes a snippet line that looks like a result heading', () => {
    const text = renderWebSearchText({
      status: 'success',
      kind: 'results',
      engine: 'brave',
      query: 'heading',
      results: [
        {
          title: 'Real',
          url: 'https://a.example/one',
          snippet: '## 9. Fake result\nmore',
        },
      ],
    });

    const lines = (text ?? '').split('\n');
    expect(lines).toContain('> ## 9. Fake result');
    expect(lines).toContain('> more');
    expect(lines).not.toContain('## 9. Fake result');
  });

  it('keeps a title with a line break on one result line', () => {
    const text = renderWebSearchText({
      status: 'success',
      kind: 'results',
      engine: 'brave',
      query: 'title',
      results: [{ title: 'Line one\nline two', url: 'https://a.example/one' }],
    });

    expect((text ?? '').split('\n')).toContain('## 1. Line one line two');
  });

  it('keeps a title with a Unicode line separator on one result line', () => {
    const text = renderWebSearchText({
      status: 'success',
      kind: 'results',
      engine: 'brave',
      query: 'title',
      results: [
        { title: 'One\u2028## 9. Fake\u2029end', url: 'https://a.example/one' },
      ],
    });

    expect((text ?? '').split(/\r?\n|\u2028|\u2029/u)).toContain(
      '## 1. One ## 9. Fake end',
    );
  });

  it('quotes a snippet line after a Unicode line separator', () => {
    const text = renderWebSearchText({
      status: 'success',
      kind: 'results',
      engine: 'brave',
      query: 'q',
      results: [
        {
          title: 'T',
          url: 'https://a.example/one',
          snippet: 'a\u2028## 9. Fake\u2029b\u2028',
        },
      ],
    });

    expect((text ?? '').split('\n').slice(-3)).toEqual([
      '> a',
      '> ## 9. Fake',
      '> b',
    ]);
  });

  it('keeps a stored URL with a line break on its own line', () => {
    const text = renderWebSearchText({
      status: 'success',
      kind: 'answer',
      engine: 'claude',
      query: 'q',
      answer: 'A.',
      citations: [{ url: 'https://a.example/x\n## 9. Fake\u2028## 8. Fake' }],
    });

    expect((text ?? '').split('\n').at(-1)).toBe(
      '[1] https://a.example/x ## 9. Fake ## 8. Fake',
    );
  });

  it('keeps a framing value with a line break on its own line', () => {
    const text = renderWebSearchText({
      status: 'success',
      kind: 'results',
      engine: 'broad\nsearch',
      query: 'line one\nline two',
      notes: ['exa\nrate_limited'],
      results: [{ title: 'R', url: 'https://a.example/one' }],
      answers: [
        {
          engine: 'claude\nsearch',
          answer: 'Grounded.',
          citations: [{ url: 'https://a.example/one' }],
        },
      ],
    });

    const lines = (text ?? '').split('\n');
    expect(lines[0]).toBe('[engine: broad search; query: line one line two]');
    expect(lines).toContain('## Answer (claude search)');
    expect(lines.at(-1)).toBe('[exa rate_limited]');
  });

  it('renders an answer output as its answer and citations', () => {
    expect(
      renderWebSearchText({
        status: 'success',
        kind: 'answer',
        engine: 'perplexity',
        query: 'what changed',
        answer: 'One answer.\nSecond line.',
        citations: [
          { url: 'https://a.example/one' },
          { url: 'https://b.example/two' },
        ],
      }),
    ).toBe(
      [
        '[engine: perplexity; query: what changed]',
        '## Answer (perplexity)',
        '> One answer.',
        '> Second line.',
        '[1] https://a.example/one',
        '[2] https://b.example/two',
      ].join('\n'),
    );
  });

  it('shows a published date only as its date', () => {
    const text = renderWebSearchText({
      status: 'success',
      kind: 'results',
      engine: 'brave',
      query: 'date',
      results: [
        {
          title: 'Dated',
          url: 'https://a.example/one',
          published: '2026-10-08T03:04:05Z',
        },
      ],
    });

    expect((text ?? '').split('\n')).toContain('a.example · 2026-10-08');
  });

  it('renders a result without a title through its URL', () => {
    const text = renderWebSearchText({
      status: 'success',
      kind: 'results',
      engine: 'brave',
      query: 'untitled',
      results: [
        { title: '   ', url: 'https://a.example/one' },
        { title: '', url: 'https://b.example/two' },
      ],
    });

    const lines = (text ?? '').split('\n');
    expect(lines).toContain('## 1. https://a.example/one');
    expect(lines).toContain('## 2. https://b.example/two');
  });

  it('quotes every snippet line and drops only the trailing ones', () => {
    const text = renderWebSearchText({
      status: 'success',
      kind: 'results',
      engine: 'brave',
      query: 'breaks',
      results: [
        { title: 'T', url: 'https://a.example/one', snippet: 'a\r\nb\rc\n\n' },
      ],
    });

    expect((text ?? '').split('\n').slice(-3)).toEqual(['> a', '> b', '> c']);
  });

  it('ends the text with the cap notice a shortened result carries', () => {
    const text = renderWebSearchText({
      status: 'success',
      kind: 'results',
      engine: 'brave',
      query: 'capped',
      notes: ['exa: empty'],
      truncated: true,
      truncationNotice:
        'Result truncated to fit the 16000-character tool-result cap; 42 characters omitted.',
      results: [{ title: 'R', url: 'https://a.example/one' }],
    });

    expect((text ?? '').split('\n').at(-1)).toBe(
      '[Result truncated to fit the 16000-character tool-result cap; 42 characters omitted.]',
    );
  });

  it('keeps the JSON rendering of a payload outside the two shapes', () => {
    expect(
      renderWebSearchText({
        status: 'error',
        type: 'web_search_failed',
        message: 'All web search engines failed: brave: upstream_error',
      }),
    ).toBeUndefined();
    expect(
      renderWebSearchText({
        status: 'success',
        kind: 'empty',
        engine: 'brave',
      }),
    ).toBeUndefined();
  });

  it('keeps the JSON rendering of a result URL that names no host', () => {
    expect(
      renderWebSearchText({
        status: 'success',
        kind: 'results',
        engine: 'brave',
        query: 'mail',
        results: [{ title: 'Mail', url: 'mailto:a@b' }],
      }),
    ).toBeUndefined();
  });
});

it('counts an 8,000-unit answer line as the pieces the reader numbers', () => {
  const longAnswer: ToolResult = {
    status: 'success',
    kind: 'answer',
    engine: 'hosted',
    query: 'question',
    answer: 'a'.repeat(8000),
    citations: [
      { url: 'https://example.test/one' },
      { url: 'https://example.test/two' },
    ],
  };

  const rendered = renderWebSearchOutput(
    webSearchOutputSchema.parse(longAnswer),
  );

  // Framing line 1; the `> ` prefix pushes the answer over 8,000 units, so it
  // is two artifact lines and the block ends after both citations.
  expect(rendered?.blocks).toEqual([
    {
      locators: ['https://example.test/one', 'https://example.test/two'],
      start: 2,
      end: 6,
      text: [
        '## Answer (hosted)',
        `> ${'a'.repeat(8000)}`,
        '[1] https://example.test/one',
        '[2] https://example.test/two',
      ].join('\n'),
    },
  ]);
});

it('shifts a later block past the pieces of a long answer', () => {
  const output: ToolResult = {
    status: 'success',
    kind: 'results',
    engine: 'hosted',
    query: 'question',
    results: [{ title: 'First', url: 'https://example.test/first' }],
    answers: [
      {
        engine: 'hosted',
        answer: 'a'.repeat(8000),
        citations: [{ url: 'https://example.test/cited' }],
      },
      {
        engine: 'second',
        answer: 'short',
        citations: [{ url: 'https://example.test/second' }],
      },
    ],
  };

  const rendered = renderWebSearchOutput(webSearchOutputSchema.parse(output));

  // Result lines 2-4, blank 5, then the long answer at 6 (heading, two
  // answer pieces, citation) ends at 9, blank 10, so the next block starts 11.
  expect(rendered?.blocks[1]?.start).toBe(6);
  expect(rendered?.blocks[1]?.end).toBe(9);
  expect(rendered?.blocks[2]?.start).toBe(11);
});
