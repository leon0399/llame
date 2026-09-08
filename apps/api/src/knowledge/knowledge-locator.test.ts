import { sep } from 'node:path';

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

  // `toStrictEqual`, not `toEqual`: a `selector: undefined` key would satisfy
  // the looser matcher, and absent-versus-undefined is the distinction the
  // reader acts on.
  it('splits the path and the selector', () => {
    expect(parseKnowledgeLocator(`${SPACE}/research/note.md`)).toStrictEqual({
      knowledgeSpaceId: SPACE,
      relativePath: 'research/note.md',
    });
    expect(
      parseKnowledgeLocator(`${SPACE}/research/note.md:41-53`),
    ).toStrictEqual({
      knowledgeSpaceId: SPACE,
      relativePath: 'research/note.md',
      selector: '41-53',
    });
    expect(parseKnowledgeLocator(`${SPACE}/note.md:raw:1-2`)).toStrictEqual({
      knowledgeSpaceId: SPACE,
      relativePath: 'note.md',
      selector: 'raw:1-2',
    });
  });

  // A selector on the Space directory itself: the colon opens the remainder,
  // so the path is empty and only the selector survives.
  it('selects the Space directory with a leading selector', () => {
    expect(parseKnowledgeLocator(`${SPACE}/:raw`)).toStrictEqual({
      knowledgeSpaceId: SPACE,
      selector: 'raw',
    });
    expect(parseKnowledgeLocator(`${SPACE}/:1-5`)).toStrictEqual({
      knowledgeSpaceId: SPACE,
      selector: '1-5',
    });
  });

  it('marks a trailing separator so the reader applies the native rule', () => {
    expect(parseKnowledgeLocator(`${SPACE}/notes/`)).toStrictEqual({
      knowledgeSpaceId: SPACE,
      relativePath: 'notes',
      trailingSeparator: true,
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

  type ResolveCall = { relativePath: string | undefined; signal?: AbortSignal };

  function contextWithAdapter(
    resolveHostPath: (
      relativePath: string | undefined,
      signal?: AbortSignal,
    ) => Promise<string>,
    calls: Array<ResolveCall>,
    abortSignal?: AbortSignal,
    bindingCalls: Array<[string, string]> = [],
  ): ToolContext {
    const resolver: KnowledgeToolResolver = {
      listForOwnerPage: () => Promise.resolve({ spaces: [] }),
      resolveBindingForOwnerById: (ownerUserId, knowledgeSpaceId) => {
        bindingCalls.push([ownerUserId, knowledgeSpaceId]);
        return Promise.resolve({
          id: SPACE,
          name: 'Personal',
          root: '/srv/knowledge',
          directory: `/srv/knowledge/${SPACE}`,
        });
      },
      createAdapter: () => ({
        search: () => {
          throw new Error('not reached');
        },
        resolveHostPath: (relativePath, signal) => {
          calls.push({ relativePath, signal });
          return resolveHostPath(relativePath, signal);
        },
      }),
    };
    return {
      userId: 'owner',
      chatId: 'chat',
      tenantDb: { runAs: () => Promise.reject(new Error('unused')) },
      knowledgeResolver: resolver,
      abortSignal,
    };
  }

  const hostPath = `/srv/knowledge/${SPACE}/note.md`;

  it('resolves a note and passes the relative path and signal through', async () => {
    const calls: Array<ResolveCall> = [];
    // A real signal, not `undefined`: asserting against `undefined` would pass
    // just as happily if the resolver stopped forwarding it at all.
    const controller = new AbortController();
    const context = contextWithAdapter(
      () => Promise.resolve(hostPath),
      calls,
      controller.signal,
    );
    // `toStrictEqual`: an absent selector must be an absent key, not an
    // `undefined` one, because the reader branches on its presence.
    await expect(
      resolveKnowledgeLocator(
        context,
        `kb://${SPACE}/note.md`,
        `${SPACE}/note.md`,
      ),
    ).resolves.toStrictEqual({
      hostPath,
      locator: `kb://${SPACE}/note.md`,
      knowledgeSpaceId: SPACE,
      knowledgeSpaceName: 'Personal',
    });
    expect(calls).toStrictEqual([
      { relativePath: 'note.md', signal: controller.signal },
    ]);
  });

  // Identity comes from the authenticated Run owner on the context, never from
  // the locator: the resolver must be asked for this owner's Space, so a
  // caller-supplied identifier can only ever name a Space the owner holds.
  it('looks the Space up as the trusted owner', async () => {
    const calls: Array<ResolveCall> = [];
    const bindingCalls: Array<[string, string]> = [];
    await resolveKnowledgeLocator(
      contextWithAdapter(
        () => Promise.resolve(hostPath),
        calls,
        undefined,
        bindingCalls,
      ),
      `kb://${SPACE}/note.md`,
      `${SPACE}/note.md`,
    );
    expect(bindingCalls).toStrictEqual([['owner', SPACE]]);
  });

  it('carries a selector onto the resolved target', async () => {
    const calls: Array<ResolveCall> = [];
    await expect(
      resolveKnowledgeLocator(
        contextWithAdapter(() => Promise.resolve(hostPath), calls),
        `kb://${SPACE}/note.md:41-53`,
        `${SPACE}/note.md:41-53`,
      ),
    ).resolves.toMatchObject({ selector: '41-53' });
  });

  it('keeps a trailing separator on the resolved host path', async () => {
    const calls: Array<ResolveCall> = [];
    const directory = `/srv/knowledge/${SPACE}/notes`;
    await expect(
      resolveKnowledgeLocator(
        contextWithAdapter(() => Promise.resolve(directory), calls),
        `kb://${SPACE}/notes/`,
        `${SPACE}/notes/`,
      ),
    ).resolves.toMatchObject({ hostPath: `${directory}${sep}` });
  });

  it('refuses a malformed identifier without touching the resolver', async () => {
    const calls: Array<ResolveCall> = [];
    await expect(
      resolveKnowledgeLocator(
        contextWithAdapter(() => Promise.resolve(hostPath), calls),
        'kb://not-a-space/note.md',
        'not-a-space/note.md',
      ),
    ).resolves.toStrictEqual({
      status: 'error',
      type: 'knowledge_space_not_found',
      message: 'Knowledge Space was not found.',
    });
    expect(calls).toStrictEqual([]);
  });

  it('refuses an unparseable locator as an invalid path', async () => {
    const calls: Array<ResolveCall> = [];
    await expect(
      resolveKnowledgeLocator(
        contextWithAdapter(() => Promise.resolve(hostPath), calls),
        `kb://${SPACE}/a:b.md`,
        `${SPACE}/a:b.md`,
      ),
    ).resolves.toStrictEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'The Knowledge locator is invalid.',
    });
  });

  it.each([
    ['knowledge_not_found', 'not_found', 'File not found.'],
    [
      'knowledge_path_invalid',
      'invalid_path',
      'The Knowledge locator is invalid.',
    ],
  ] as const)(
    'reports %s in the native vocabulary',
    async (code, type, message) => {
      const calls: Array<ResolveCall> = [];
      await expect(
        resolveKnowledgeLocator(
          contextWithAdapter(
            () => Promise.reject(new KnowledgeFilesystemError(code)),
            calls,
          ),
          `kb://${SPACE}/note.md`,
          `${SPACE}/note.md`,
        ),
      ).resolves.toStrictEqual({ status: 'error', type, message });
    },
  );

  it('rethrows a cancelled resolution instead of answering the owner', async () => {
    const calls: Array<ResolveCall> = [];
    await expect(
      resolveKnowledgeLocator(
        contextWithAdapter(
          () =>
            Promise.reject(new KnowledgeFilesystemError('knowledge_cancelled')),
          calls,
        ),
        `kb://${SPACE}/note.md`,
        `${SPACE}/note.md`,
      ),
    ).rejects.toMatchObject({ code: 'knowledge_cancelled' });
  });

  it('closes a non-Knowledge resolution failure as unavailable', async () => {
    const calls: Array<ResolveCall> = [];
    await expect(
      resolveKnowledgeLocator(
        contextWithAdapter(() => Promise.reject(new Error('disk gone')), calls),
        `kb://${SPACE}/note.md`,
        `${SPACE}/note.md`,
      ),
    ).resolves.toStrictEqual({
      status: 'error',
      type: 'knowledge_space_unavailable',
      message: 'The Knowledge Space is unavailable.',
    });
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
