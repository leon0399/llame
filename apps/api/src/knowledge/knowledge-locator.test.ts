import { sep } from 'node:path';

import { type ToolResult } from '@workspace/runtime-safety';

import { KnowledgeFilesystemError } from './knowledge-filesystem';
import {
  parseKnowledgeLocator,
  type ResolvedKnowledgeTarget,
  resolveKnowledgeLocator,
} from './knowledge-locator';
import { type KnowledgeToolResolver, type ToolContext } from '../tools/types';

const SPACE = '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e';

describe('knowledge locator parsing', () => {
  it.each([
    ['notes/Pet%20Projects.md', 'notes/Pet Projects.md'],
    ['notes/Pet Projects.md', 'notes/Pet Projects.md'],
    ['notes/a%3Ab.md', 'notes/a:b.md'],
    ['notes/%252E%252E.md', 'notes/%2E%2E.md'],
    ['%252E%252E', '%2E%2E'],
    ['notes/100%25.md', 'notes/100%.md'],
  ])('decodes %s exactly once', (path, relativePath) => {
    expect(parseKnowledgeLocator(`${SPACE}/${path}:1-2`)).toStrictEqual({
      knowledgeSpaceId: SPACE,
      relativePath,
      selector: '1-2',
    });
  });

  it.each(['notes%2Fsecret.md', '100%.md', 'note.md:%31-2'])(
    'refuses invalid encoding in %s',
    (path) => {
      expect(parseKnowledgeLocator(`${SPACE}/${path}`)).toBeUndefined();
    },
  );

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

  it('splits a comma selector and rejects a malformed suffix', () => {
    expect(
      parseKnowledgeLocator(`${SPACE}/research/note.md:5-10,20-30`),
    ).toStrictEqual({
      knowledgeSpaceId: SPACE,
      relativePath: 'research/note.md',
      selector: '5-10,20-30',
    });
    expect(
      parseKnowledgeLocator(`${SPACE}/research/note.md:raw:5-10,20-30`),
    ).toStrictEqual({
      knowledgeSpaceId: SPACE,
      relativePath: 'research/note.md',
      selector: 'raw:5-10,20-30',
    });
    expect(
      parseKnowledgeLocator(`${SPACE}/research/note.md:5-10,,20-30`),
    ).toBeUndefined();
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

  type ResolveCall = {
    relativePath: string | undefined;
    allowMissing?: boolean | undefined;
    createDirectories?: boolean | undefined;
    signal?: AbortSignal | undefined;
  };

  type AdapterOptions = {
    abortSignal?: AbortSignal;
    isInsideSpace?: (hostPath: string) => Promise<boolean>;
    bindingCalls?: Array<[string, string]>;
  };

  function contextWithAdapter(
    resolveHostPath: (relativePath: string | undefined) => Promise<string>,
    calls: Array<ResolveCall>,
    options: AdapterOptions = {},
  ): ToolContext {
    const isInsideSpace =
      options.isInsideSpace ?? (() => Promise.resolve(true));
    const bindingCalls = options.bindingCalls ?? [];
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
        isInsideSpace: (candidate) => isInsideSpace(candidate),
        resolveHostPath: (relativePath, options) => {
          calls.push({
            relativePath,
            allowMissing: options?.allowMissing,
            createDirectories: options?.createDirectories,
            signal: options?.signal,
          });
          return resolveHostPath(relativePath);
        },
      }),
    };
    return {
      userId: 'owner',
      chatId: 'chat',
      tenantDb: { runAs: () => Promise.reject(new Error('unused')) },
      knowledgeResolver: resolver,
      abortSignal: options.abortSignal,
    };
  }

  /** Narrows the union without a cast, and fails loudly with the refusal type
   *  when resolution answered a result instead of a target. */
  function expectTarget(
    value: ResolvedKnowledgeTarget | ToolResult,
  ): ResolvedKnowledgeTarget {
    if ('status' in value) {
      throw new Error(`expected a resolved target, got ${value.status}`);
    }
    return value;
  }

  const hostPath = `/srv/knowledge/${SPACE}/note.md`;

  it('resolves a note and passes the relative path and signal through', async () => {
    const calls: Array<ResolveCall> = [];
    // A real signal, not `undefined`: asserting against `undefined` would pass
    // just as happily if the resolver stopped forwarding it at all.
    const controller = new AbortController();
    const context = contextWithAdapter(() => Promise.resolve(hostPath), calls, {
      abortSignal: controller.signal,
    });
    const target = await resolveKnowledgeLocator(
      context,
      `kb://${SPACE}/note.md`,
      `${SPACE}/note.md`,
    );
    expect(target).toMatchObject({
      hostPath,
      locator: `kb://${SPACE}/note.md`,
      knowledgeSpaceId: SPACE,
      knowledgeSpaceName: 'Personal',
    });
    // An absent selector must be an absent key, not an `undefined` one: the
    // reader branches on its presence, and `toMatchObject` would not notice.
    expect(Object.keys(target).toSorted()).toStrictEqual([
      'assertInsideSpace',
      'createDirectories',
      'hostPath',
      'knowledgeSpaceId',
      'knowledgeSpaceName',
      'locator',
    ]);
    // Resolution decides admissibility; it never creates anything.
    expect(calls).toStrictEqual([
      {
        relativePath: 'note.md',
        allowMissing: false,
        createDirectories: undefined,
        signal: controller.signal,
      },
    ]);
  });

  it('tolerates a missing target only when the caller asks', async () => {
    const calls: Array<ResolveCall> = [];
    await resolveKnowledgeLocator(
      contextWithAdapter(() => Promise.resolve(hostPath), calls),
      `kb://${SPACE}/note.md`,
      `${SPACE}/note.md`,
      true,
    );
    expect(calls).toMatchObject([{ allowMissing: true }]);
  });

  // The deferred effect runs after the durable attempt is recorded, so it is a
  // second walk that creates the directories resolution only tolerated.
  it('creates directories as a deferred effect', async () => {
    const calls: Array<ResolveCall> = [];
    const target = await resolveKnowledgeLocator(
      contextWithAdapter(() => Promise.resolve(hostPath), calls),
      `kb://${SPACE}/notes/note.md`,
      `${SPACE}/notes/note.md`,
      true,
    );
    await expect(
      expectTarget(target).createDirectories(),
    ).resolves.toBeUndefined();
    expect(calls).toMatchObject([
      { allowMissing: true, createDirectories: undefined },
      { allowMissing: true, createDirectories: true },
    ]);
  });

  it('reports a deferred creation failure in the native vocabulary', async () => {
    const calls: Array<ResolveCall> = [];
    let attempts = 0;
    const target = await resolveKnowledgeLocator(
      contextWithAdapter(() => {
        attempts += 1;
        return attempts === 1
          ? Promise.resolve(hostPath)
          : Promise.reject(
              new KnowledgeFilesystemError('knowledge_not_directory'),
            );
      }, calls),
      `kb://${SPACE}/notes/note.md`,
      `${SPACE}/notes/note.md`,
      true,
    );
    await expect(
      expectTarget(target).createDirectories(),
    ).resolves.toStrictEqual({
      status: 'error',
      type: 'not_regular_file',
      message: 'A path component is not a directory.',
    });
  });

  it.each([
    [true, undefined],
    [
      false,
      {
        status: 'error',
        type: 'knowledge_space_not_found',
        message: 'Knowledge Space was not found.',
      },
    ],
  ])('answers the late containment check for %s', async (inside, expected) => {
    const calls: Array<ResolveCall> = [];
    const target = await resolveKnowledgeLocator(
      contextWithAdapter(() => Promise.resolve(hostPath), calls, {
        isInsideSpace: () => Promise.resolve(inside),
      }),
      `kb://${SPACE}/note.md`,
      `${SPACE}/note.md`,
    );
    await expect(
      expectTarget(target).assertInsideSpace(),
    ).resolves.toStrictEqual(expected);
  });

  // Identity comes from the authenticated Run owner on the context, never from
  // the locator: the resolver must be asked for this owner's Space, so a
  // caller-supplied identifier can only ever name a Space the owner holds.
  it('looks the Space up as the trusted owner', async () => {
    const calls: Array<ResolveCall> = [];
    const bindingCalls: Array<[string, string]> = [];
    await resolveKnowledgeLocator(
      contextWithAdapter(() => Promise.resolve(hostPath), calls, {
        bindingCalls,
      }),
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

  it('refuses a malformed comma suffix as an invalid path', async () => {
    const calls: Array<ResolveCall> = [];
    await expect(
      resolveKnowledgeLocator(
        contextWithAdapter(() => Promise.resolve(hostPath), calls),
        `kb://${SPACE}/note.md:5-10,,20-30`,
        `${SPACE}/note.md:5-10,,20-30`,
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
