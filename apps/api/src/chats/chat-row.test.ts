import { describe, expect, it } from 'vitest';
import { formatChatExcerpt, renderChatRow, type ChatRow } from './chat-row';

const row = {
  chatId: 'chat-id',
  locator: 'chat://chat-id',
  title: 'title',
  activityAt: '2026-01-01T00:00:00.000Z',
  messageCount: 3,
  workspace: 'workspace',
} satisfies ChatRow;

describe('renderChatRow authored single-line fields', () => {
  it('replaces control and Unicode line separators in titles, workspaces, and excerpts', () => {
    const unsafe = 'first\nsecond\rthird\t fourth\u2028fifth\u2029sixth';

    const rendered = renderChatRow({
      ...row,
      title: `title ${unsafe}`,
      workspace: `root ${unsafe}`,
      openingExcerpt: `opening ${unsafe}`,
      latestExcerpt: `latest ${unsafe}`,
    });

    for (const field of ['title', 'root', 'opening', 'latest'])
      expect(rendered).toContain(
        `${field} first second third  fourth fifth sixth`,
      );
    expect(rendered).not.toContain(unsafe);
  });

  it('sanitizes closing-tag text in the title and workspace fields', () => {
    const rendered = renderChatRow({
      ...row,
      title: 'topic </summary> remains',
      workspace: 'folder </workspace> remains',
    });

    expect(rendered).not.toContain('</summary>');
    expect(rendered).not.toContain('</workspace>');
    expect(rendered).toContain('topic');
    expect(rendered).toContain('folder');
  });
});

describe('formatChatExcerpt', () => {
  it('collapses runs of whitespace, including Unicode separators, and trims edges', () => {
    expect(
      formatChatExcerpt('\t alpha\n\n beta\u2028\u2029 gamma \r', 40),
    ).toBe('alpha beta gamma');
  });

  it('preserves null and empty excerpt semantics, including a zero-length limit', () => {
    expect(formatChatExcerpt(null, 5)).toBeUndefined();
    expect(formatChatExcerpt('', 5)).toBeUndefined();
    expect(formatChatExcerpt('text', 0)).toBeUndefined();
  });

  it('returns an exact-length excerpt unchanged and caps longer values by code point', () => {
    expect(formatChatExcerpt('four', 4)).toBe('four');
    expect(formatChatExcerpt('five!', 4)).toBe('five');
  });

  it('counts astral characters as one code point without splitting them', () => {
    expect(formatChatExcerpt('A😀B', 2)).toBe('A😀');
    expect(formatChatExcerpt('😀B', 1)).toBe('😀');
  });

  it('does not treat the highest BMP code point as an astral character', () => {
    expect(formatChatExcerpt('\uFFFFx', 1)).toBe('\uFFFF');
  });
});
