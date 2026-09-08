import { KnowledgeFilesystemError } from './knowledge-filesystem';
import {
  parseKnowledgeLocator,
  resolveKnowledgeLocator,
} from './knowledge-locator';
import { type KnowledgeToolResolver, type ToolContext } from '../tools/types';

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

describe('knowledge locator resolution', () => {
  function contextWith(failure: Error): ToolContext {
    const resolver: KnowledgeToolResolver = {
      listForOwnerPage: () => Promise.resolve({ spaces: [] }),
      resolveBindingForOwnerById: () => Promise.reject(failure),
      createAdapter: () => {
        throw new Error('not reached');
      },
    };
    return {
      userId: 'owner',
      chatId: 'chat',
      tenantDb: { runAs: () => Promise.reject(new Error('unused')) },
      knowledgeResolver: resolver,
    };
  }

  it('propagates cancellation instead of reporting it as unavailable', async () => {
    // An aborted call is the runner own signal, not an owner-facing result;
    // swallowing it would report a Space as broken when the Run was cancelled.
    await expect(
      resolveKnowledgeLocator(
        contextWith(new KnowledgeFilesystemError('knowledge_cancelled')),
        `kb://${SPACE}/note.md`,
        `${SPACE}/note.md`,
      ),
    ).rejects.toMatchObject({ code: 'knowledge_cancelled' });
  });

  it('closes every other binding failure as unavailable', async () => {
    await expect(
      resolveKnowledgeLocator(
        contextWith(new Error('/srv/knowledge exploded')),
        `kb://${SPACE}/note.md`,
        `${SPACE}/note.md`,
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'knowledge_space_unavailable',
      message: 'The Knowledge Space is unavailable.',
    });
  });
});
