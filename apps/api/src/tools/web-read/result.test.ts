import { measureNativeModelOutput } from '@workspace/native-file-tools';
import { RESULT_TRUNCATE_CHARS } from '@workspace/runtime-safety';

import { type WebRender } from './pipeline';
import { buildWebReadResult } from './result';

const GUIDE_URL = 'https://example.test/guide';

/** A rendered text of `count` lines, wide enough to exceed the shared bound. */
function renderedLines(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `line ${index + 1} ${'x'.repeat(60)}`,
  ).join('\n');
}

/** Lines `first` through `last` exactly as the reader emits them: numbered,
 *  or verbatim for a `:raw` read, each with its source line delimiter. */
function readWindow(first: number, last: number, raw = false): string {
  return Array.from(
    { length: last - first + 1 },
    (_, index) =>
      `${raw ? '' : `${first + index}: `}line ${first + index} ${'x'.repeat(60)}\n`,
  ).join('');
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

  it('applies a comma selector to the rendered text', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: '4-5,7-8' },
      { finalUrl: GUIDE_URL, contentType: 'text/html', body: '' },
      { method: 'readability', content: renderedLines(12) },
    );
    expect(result).toMatchObject({
      path: GUIDE_URL,
      representation: 'text',
      requestedRanges: [
        { startLine: 4, endLine: 5 },
        { startLine: 7, endLine: 8 },
      ],
      shownRanges: [{ startLine: 3, endLine: 9 }],
      truncated: false,
      finalUrl: GUIDE_URL,
      method: 'readability',
    });
    expect(result).toHaveProperty('content', readWindow(3, 9));
    expect(result).not.toHaveProperty('nextOffset');
    expect(result).not.toHaveProperty('requestedRange');
    expect(result).not.toHaveProperty('shownRange');
  });

  it('merges touching comma ranges into one requested range and block', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: '4-5,6-7' },
      { finalUrl: GUIDE_URL, contentType: 'text/html', body: '' },
      { method: 'readability', content: renderedLines(12) },
    );
    expect(result).toMatchObject({
      requestedRanges: [{ startLine: 4, endLine: 7 }],
      shownRanges: [{ startLine: 3, endLine: 8 }],
      truncated: false,
    });
    expect(result).toHaveProperty('content', readWindow(3, 8));
  });

  it('clips a comma selector whose later range starts past EOF', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: '2-3,99-100' },
      { finalUrl: GUIDE_URL, contentType: 'text/html', body: '' },
      { method: 'readability', content: renderedLines(12) },
    );
    expect(result).toMatchObject({
      requestedRanges: [
        { startLine: 2, endLine: 3 },
        { startLine: 99, endLine: 100 },
      ],
      shownRanges: [{ startLine: 1, endLine: 4 }],
      truncated: false,
    });
    expect(result).toHaveProperty('content', readWindow(1, 4));
    expect(result).not.toHaveProperty('nextOffset');
  });

  it('rolls a later comma range back when the render exhausts the bound', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: '1-200,400-500' },
      { finalUrl: GUIDE_URL, contentType: 'text/html', body: '' },
      { method: 'readability', content: renderedLines(600) },
    );
    expect(result).toMatchObject({
      shownRanges: [{ startLine: 1, endLine: 201 }],
      truncated: true,
      nextOffset: 398,
    });
    expect(result).toHaveProperty('content', readWindow(1, 201));
    expect(measureNativeModelOutput(result)).toBeLessThanOrEqual(
      RESULT_TRUNCATE_CHARS,
    );
  });

  it('returns raw comma ranges verbatim', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: 'raw:4-5,7-8' },
      { finalUrl: GUIDE_URL, contentType: 'text/html', body: '' },
      { method: 'readability', content: renderedLines(12) },
    );
    expect(result).toMatchObject({
      representation: 'raw',
      requestedRanges: [
        { startLine: 4, endLine: 5 },
        { startLine: 7, endLine: 8 },
      ],
      shownRanges: [
        { startLine: 4, endLine: 5 },
        { startLine: 7, endLine: 8 },
      ],
      truncated: false,
    });
    expect(result).toHaveProperty(
      'content',
      readWindow(4, 5, true) + readWindow(7, 8, true),
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

  it('propagates a failure that is not the reader’s own', () => {
    // The catch maps the reader's own refusals and nothing else: a defect
    // raised while the render is read must surface, not be dressed as a read
    // failure the model would report as the page's answer.
    const failing = {
      method: 'text',
      get content(): string {
        throw new Error('the render never produced text');
      },
    } satisfies WebRender;
    expect(() =>
      buildWebReadResult(
        { url: GUIDE_URL },
        { finalUrl: GUIDE_URL, contentType: 'text/plain', body: '' },
        failing,
      ),
    ).toThrow('the render never produced text');
  });
});
