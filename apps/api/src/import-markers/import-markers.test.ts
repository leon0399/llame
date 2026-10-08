import { describe, expect, it } from 'vitest';
import { importTargets } from './import-markers';

describe('importTargets', () => {
  it('does not recognize an email address', () => {
    expect(importTargets('user@example.com')).toEqual([]);
  });

  it('does not recognize a marker in inline code', () => {
    expect(importTargets('`@README.md`')).toEqual([]);
  });

  it('does not recognize a marker in a fenced code block', () => {
    expect(importTargets('```\n@README.md\n```')).toEqual([]);
  });

  it('does not recognize a marker in raw HTML', () => {
    expect(importTargets('<div>\n@README.md\n</div>')).toEqual([]);
  });

  it('does not recognize an image destination', () => {
    expect(importTargets('![x](@a.md)')).toEqual([]);
  });

  it('does not recognize an image reference', () => {
    expect(importTargets('![x][r]\n\n[r]: a.md')).toEqual([]);
  });

  it('does not recognize a link reference', () => {
    expect(importTargets('[@a.md][r]')).toEqual([]);
    expect(importTargets('[@a.md][r]\n\n[r]: a.md')).toEqual([]);
  });

  it('does not recognize a link reference definition', () => {
    expect(importTargets('[r]: @a.md "import"')).toEqual([]);
  });

  it('strips sentence punctuation from a bare target', () => {
    expect(importTargets('see @docs/a.md.')).toEqual(['docs/a.md']);
  });

  it('keeps a selector suffix on a bare target', () => {
    expect(importTargets('@README.md:30-35')).toEqual(['README.md:30-35']);
  });

  it('recognizes a marker after an opening parenthesis', () => {
    expect(importTargets('(@a.md)')).toEqual(['a.md']);
  });

  it('strips a closing angle bracket from a bare target', () => {
    expect(importTargets('see <@a.md> now')).toEqual(['a.md']);
  });

  it('does not use formatting punctuation as a boundary', () => {
    expect(importTargets('**leo**@example.com')).toEqual([]);
  });

  it('keeps a bare marker intact when emphasis splits its path', () => {
    expect(importTargets('@pkg/__init__.py')).toEqual(['pkg/__init__.py']);
  });

  it('keeps a test path as one target', () => {
    expect(importTargets('@apps/api/__tests__/x.test.ts')).toEqual([
      'apps/api/__tests__/x.test.ts',
    ]);
  });

  it('does not recognize an escaped at-sign', () => {
    expect(importTargets(String.raw`\@notes.md`)).toEqual([]);
  });

  it('does not recognize an at-sign entity', () => {
    expect(importTargets('&#64;notes.md')).toEqual([]);
  });

  it('does not recognize a plain Markdown link', () => {
    expect(importTargets('[docs](README.md)')).toEqual([]);
  });

  it('recognizes a titled Markdown link with the exact import title', () => {
    expect(importTargets('[docs](README.md "import")')).toEqual(['README.md']);
  });

  it('recognizes an at-prefixed Markdown link', () => {
    expect(importTargets('@[docs](README.md)')).toEqual(['README.md']);
  });

  it('does not recognize an at-prefixed link with another title', () => {
    expect(importTargets('@[docs](README.md "Import")')).toEqual([]);
  });

  it('does not recognize a mid-word at-prefixed Markdown link', () => {
    expect(importTargets('foo@[x](y)')).toEqual([]);
  });

  it('does not recognize a titled link whose title has different casing', () => {
    expect(importTargets('[docs](README.md "Import")')).toEqual([]);
  });

  it('recognizes an angle-bracket destination with spaces', () => {
    expect(importTargets('[d](<a b.md> "import")')).toEqual(['a b.md']);
  });

  it('uses source characters across CRLF line endings', () => {
    expect(importTargets('see @a.md.\r\n@b.md\r\n')).toEqual(['a.md', 'b.md']);
  });

  it('does not scan after an unclosed fence', () => {
    expect(importTargets('@before.md\n```\n@inside.md\n@after.md')).toEqual([
      'before.md',
    ]);
  });

  it('keeps marker-bearing source text unchanged', () => {
    const source = 'see @a.md and [docs](b.md "import")';
    expect(importTargets(source)).toEqual(['a.md', 'b.md']);
    expect(source).toBe('see @a.md and [docs](b.md "import")');
  });

  it('deduplicates targets in first-occurrence order', () => {
    expect(
      importTargets('@a.md\n@[B](b.md)\n[again](a.md "import")\n@c.md\n@b.md'),
    ).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('treats selector variants as distinct targets', () => {
    expect(importTargets('@README.md:raw\n@README.md:outline')).toEqual([
      'README.md:raw',
      'README.md:outline',
    ]);
  });

  it('parses a one-mebibyte input without losing its marker', () => {
    const marker = '@README.md ';
    const source = marker + 'x'.repeat(1024 * 1024 - marker.length);
    expect(source).toHaveLength(1024 * 1024);
    expect(importTargets(source)).toEqual(['README.md']);
  });
});
