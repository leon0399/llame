import { describe, expect, it } from 'vitest';

import { type ToolResult } from '../types';
import { renderWebSearchText } from './text';

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
    const lines = (renderWebSearchText(threeResults) ?? '').split('\n');
    expect(lines.indexOf('## 1. First')).toBeLessThan(
      lines.indexOf('## 2. Second'),
    );
    expect(lines.indexOf('## 2. Second')).toBeLessThan(
      lines.indexOf('## 3. Third'),
    );
  });

  it('renders an aggregate answer after the results with its citations', () => {
    const text = renderWebSearchText({
      status: 'success',
      kind: 'results',
      engine: 'broad',
      query: 'what changed',
      notes: ['exa: rate_limited'],
      results: [
        { title: 'First', url: 'https://a.example/one', snippet: 'One.' },
        { title: 'Second', url: 'https://b.example/two', snippet: 'Two.' },
      ],
      answers: [
        {
          engine: 'claude-search',
          answer: 'Grounded.\nSecond line.',
          citations: [
            { url: 'https://a.example/one' },
            { url: 'https://b.example/two', title: 'Two' },
          ],
        },
      ],
    });
    expect(text).toBe(
      [
        '[engine: broad; query: what changed]',
        '## 1. First',
        'https://a.example/one',
        'a.example',
        '> One.',
        '',
        '## 2. Second',
        'https://b.example/two',
        'b.example',
        '> Two.',
        '',
        '## Answer (claude-search)',
        '> Grounded.',
        '> Second line.',
        '[1] https://a.example/one',
        '[2] https://b.example/two',
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

  it('keeps a query with a line break on the engine line', () => {
    const text = renderWebSearchText({
      status: 'success',
      kind: 'results',
      engine: 'brave',
      query: 'line one\nline two',
      results: [],
    });
    expect(text).toBe('[engine: brave; query: line one line two]');
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

  it('renders a result without a title through its URL', () => {
    const text = renderWebSearchText({
      status: 'success',
      kind: 'results',
      engine: 'brave',
      query: 'untitled',
      results: [{ title: '', url: 'https://a.example/one' }],
    });
    expect((text ?? '').split('\n')).toContain('## 1. https://a.example/one');
  });

  it('adds no empty quote line for a trailing snippet line break', () => {
    const text = renderWebSearchText({
      status: 'success',
      kind: 'results',
      engine: 'brave',
      query: 'snippet',
      results: [
        { title: 'T', url: 'https://a.example/one', snippet: 'One.\n' },
      ],
    });
    expect((text ?? '').split('\n').at(-1)).toBe('> One.');
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
        query: 'lan',
        results: [{ title: 'Local', url: 'not a url' }],
      }),
    ).toBeUndefined();
  });
});
