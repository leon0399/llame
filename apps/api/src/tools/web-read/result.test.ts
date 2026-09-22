import { measureNativeModelOutput } from '@workspace/native-file-tools';
import { RESULT_TRUNCATE_CHARS } from '@workspace/runtime-safety';

import { buildWebReadResult } from './result';

const GUIDE_URL = 'https://example.test/guide';

/** A rendered text of `count` lines, wide enough to exceed the shared bound. */
function renderedLines(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `line ${index + 1} ${'x'.repeat(60)}`,
  ).join('\n');
}

describe('buildWebReadResult', () => {
  it('assembles the native read result with the web envelope', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL },
      {
        finalUrl: GUIDE_URL,
        contentType: 'text/markdown',
        body: '# Guide',
      },
      { method: 'negotiated', content: '# Guide\n\nBody text\n' },
    );
    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      path: GUIDE_URL,
      representation: 'text',
      content: '1: # Guide\n2: \n3: Body text\n',
      finalUrl: GUIDE_URL,
      method: 'negotiated',
      truncated: false,
      shownRange: { startLine: 1, endLine: 3 },
    });
    expect(result).not.toHaveProperty('notes');
    expect(result).not.toHaveProperty('realPath');
    expect(result).not.toHaveProperty('url');
    expect(result).not.toHaveProperty('contentType');
    expect(result).not.toHaveProperty('markdownTokens');
    expect(JSON.stringify(result)).not.toContain('text/markdown');
  });

  it('reports the locator as path and the response as finalUrl', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL },
      {
        finalUrl: 'https://cdn.example.test/guide',
        contentType: 'text/plain',
        body: 'hello',
      },
      { method: 'text', content: 'hello\n' },
    );
    expect(result).toMatchObject({
      path: GUIDE_URL,
      finalUrl: 'https://cdn.example.test/guide',
      method: 'text',
    });
  });

  it('applies a line selector to the rendered text', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: '10-20' },
      { finalUrl: GUIDE_URL, contentType: 'text/html', body: '' },
      { method: 'readability', content: renderedLines(30) },
    );
    expect(result).toMatchObject({
      path: GUIDE_URL,
      representation: 'text',
      requestedRange: { startLine: 10, endLine: 20 },
      shownRange: { startLine: 9, endLine: 21 },
      truncated: false,
      nextOffset: 20,
      method: 'readability',
    });
    expect(result).toHaveProperty(
      'content',
      expect.stringContaining('10: line 10'),
    );
    expect(result).toHaveProperty(
      'content',
      expect.not.stringContaining('line 30'),
    );
  });

  it('returns the raw body untouched for a :raw locator', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: 'raw' },
      { finalUrl: GUIDE_URL, contentType: 'text/html', body: '<p>a</p>' },
      { method: 'raw', content: '<p>a</p>\nmore\n' },
    );
    expect(result).toMatchObject({
      representation: 'raw',
      content: '<p>a</p>\nmore\n',
      method: 'raw',
      truncated: false,
      shownRange: { startLine: 1, endLine: 2 },
    });
  });

  it('reserves the envelope before the shared bound truncates the render', () => {
    const notes = ['The page could not be converted.'];
    const result = buildWebReadResult(
      { url: GUIDE_URL },
      { finalUrl: GUIDE_URL, contentType: 'text/html', body: '' },
      { method: 'readability', content: renderedLines(1200), notes },
    );
    expect(result).toMatchObject({
      path: GUIDE_URL,
      finalUrl: GUIDE_URL,
      method: 'readability',
      notes,
      truncated: true,
    });
    expect(result).toHaveProperty('nextOffset', expect.any(Number));
    expect(result).toHaveProperty(
      'content',
      expect.not.stringContaining('line 1200'),
    );
    expect(measureNativeModelOutput(result)).toBeLessThanOrEqual(
      RESULT_TRUNCATE_CHARS,
    );
  });

  it('omits notes when the render reports none', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL },
      { finalUrl: GUIDE_URL, contentType: 'application/json', body: '{}' },
      { method: 'text', content: '{}\n', notes: [] },
    );
    expect(result).not.toHaveProperty('notes');
  });

  it('maps a selector past the end of the render to the native error', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: '5000-5010' },
      { finalUrl: GUIDE_URL, contentType: 'text/plain', body: '' },
      { method: 'text', content: 'only one line\n' },
    );
    expect(result).toMatchObject({
      status: 'error',
      type: 'invalid_selector',
    });
    expect(result).toHaveProperty('message', expect.any(String));
  });
});
