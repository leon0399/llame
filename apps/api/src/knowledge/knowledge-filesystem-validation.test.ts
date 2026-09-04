import {
  isMarkdownPath,
  joinRelativePath,
  validateBinding,
  validatePath,
  validateReadRange,
  validateSearchInput,
} from './knowledge-filesystem-validation';
import { KnowledgeFilesystemError } from './knowledge-filesystem-errors';
import {
  KNOWLEDGE_MAX_PATH_BYTES,
  KNOWLEDGE_MAX_PATH_COMPONENTS,
  KNOWLEDGE_MAX_READ_LINES,
} from './knowledge-filesystem-limits';

const MAX_SEARCH_QUERY_CODE_POINTS = 200;

const validBinding = {
  id: '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
  root: '/srv/knowledge',
  directory: '/srv/knowledge/6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
};

describe('Knowledge filesystem validation', () => {
  it('accepts a stable UUID and absolute root and directory', () => {
    expect(() => validateBinding(validBinding)).not.toThrow();
  });

  it.each([
    { id: 'not-a-v4-uuid' },
    { root: 'relative/root' },
    { directory: 'relative/directory' },
  ])('rejects an unsafe binding field %j', (override) => {
    expect(() => validateBinding({ ...validBinding, ...override })).toThrow(
      KnowledgeFilesystemError,
    );
  });

  it('enforces search query and result limits', () => {
    expect(() => validateSearchInput('needle', 1)).not.toThrow();
    expect(() => validateSearchInput('', 1)).toThrow(KnowledgeFilesystemError);
    expect(() => validateSearchInput('needle', 0)).toThrow(
      KnowledgeFilesystemError,
    );
    expect(() => validateSearchInput('needle', 11)).toThrow(
      KnowledgeFilesystemError,
    );
    expect(() => validateSearchInput('😀'.repeat(201), 1)).toThrow(
      KnowledgeFilesystemError,
    );
    expect(() => validateSearchInput('needle', 1.5)).toThrow(
      KnowledgeFilesystemError,
    );
  });

  // Upper bounds are inclusive: without a success case at exactly the cap a
  // `>` → `>=` regression would reject valid input and no test would notice.
  it('accepts a query and limit sitting exactly on their caps', () => {
    expect(() =>
      validateSearchInput('😀'.repeat(MAX_SEARCH_QUERY_CODE_POINTS), 10),
    ).not.toThrow();
  });

  it('enforces safe optional read ranges', () => {
    expect(() => validateReadRange(undefined, undefined)).not.toThrow();
    expect(() => validateReadRange(0, 1)).not.toThrow();
    for (const [offset, limit] of [
      [-1, undefined],
      [Number.MAX_SAFE_INTEGER + 1, undefined],
      [1.5, undefined],
      [undefined, 0],
      [undefined, 2001],
      [undefined, Number.MAX_SAFE_INTEGER + 1],
    ] as const) {
      expect(() => validateReadRange(offset, limit)).toThrow(
        KnowledgeFilesystemError,
      );
    }
    expect(() =>
      validateReadRange(undefined, KNOWLEDGE_MAX_READ_LINES),
    ).not.toThrow();
  });

  it('rejects absolute, traversal, control-character, and non-Markdown paths', () => {
    expect(validatePath('nested/note.md', true)).toEqual(['nested', 'note.md']);
    for (const unsafe of [
      '',
      '/absolute.md',
      'C:/absolute.md',
      String.raw`nested\note.md`,
      'nested/../note.md',
      'nested//note.md',
      'nested/./note.md',
      'nested/\u0000note.md',
      'nested/note.txt',
    ]) {
      expect(() => validatePath(unsafe, true)).toThrow(
        KnowledgeFilesystemError,
      );
    }
  });

  it('accepts a path sitting exactly on the byte and component caps', () => {
    const maxBytes = `${'a'.repeat(KNOWLEDGE_MAX_PATH_BYTES - 3)}.md`;
    expect(Buffer.byteLength(maxBytes, 'utf8')).toBe(KNOWLEDGE_MAX_PATH_BYTES);
    expect(validatePath(maxBytes, true)).toEqual([maxBytes]);

    const maxComponents = [
      ...Array.from({ length: KNOWLEDGE_MAX_PATH_COMPONENTS - 1 }, () => 'a'),
      'note.md',
    ];
    expect(validatePath(maxComponents.join('/'), true)).toEqual(maxComponents);
  });

  it('distinguishes Markdown suffixes and joins relative components', () => {
    expect(isMarkdownPath('NOTE.MD')).toBe(true);
    expect(isMarkdownPath('note.txt')).toBe(false);
    expect(joinRelativePath('', 'note.md')).toBe('note.md');
    expect(joinRelativePath('nested', 'note.md')).toBe('nested/note.md');
  });
});
