import { parseKnowledgeLocator } from './knowledge-locator';

const SPACE = '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e';

describe('knowledge locator parsing', () => {
  it('addresses the Space directory with or without a trailing separator', () => {
    expect(parseKnowledgeLocator(SPACE)).toEqual({
      knowledgeSpaceId: SPACE,
    });
    expect(parseKnowledgeLocator(`${SPACE}/`)).toEqual({
      knowledgeSpaceId: SPACE,
    });
  });

  it('splits the path and the selector', () => {
    expect(parseKnowledgeLocator(`${SPACE}/research/note.md`)).toEqual({
      knowledgeSpaceId: SPACE,
      relativePath: 'research/note.md',
    });
    expect(parseKnowledgeLocator(`${SPACE}/research/note.md:41-53`)).toEqual({
      knowledgeSpaceId: SPACE,
      relativePath: 'research/note.md',
      selector: '41-53',
    });
    expect(parseKnowledgeLocator(`${SPACE}/note.md:raw:1-2`)).toEqual({
      knowledgeSpaceId: SPACE,
      relativePath: 'note.md',
      selector: 'raw:1-2',
    });
  });

  it.each([
    '',
    '/notes/a.md',
    `${SPACE}/notes/a:b.md`,
    `${SPACE}/notes/a:b.md:41-53`,
    `${SPACE}/notes/a.md:nonsense`,
  ])('refuses %s', (rest) => {
    expect(parseKnowledgeLocator(rest)).toBeUndefined();
  });
});
