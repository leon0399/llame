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

const INVALID_PATH = {
  type: 'invalid_path',
  message: 'The Knowledge locator is invalid.',
};

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

  it.each(['notes%2Fsecret.md', '100%.md'])(
    'refuses invalid encoding in %s',
    (path) => {
      expect(parseKnowledgeLocator(`${SPACE}/${path}`)).toStrictEqual(
        INVALID_PATH,
      );
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

  it('preserves outline selectors and encoded colons in path segments', () => {
    expect(parseKnowledgeLocator(`${SPACE}/notes.md:outline`)).toStrictEqual({
      knowledgeSpaceId: SPACE,
      relativePath: 'notes.md',
      selector: 'outline',
    });
    expect(
      parseKnowledgeLocator(`${SPACE}/notes.md:outline:3-9`),
    ).toStrictEqual({
      knowledgeSpaceId: SPACE,
      relativePath: 'notes.md',
      selector: 'outline:3-9',
    });
    expect(parseKnowledgeLocator(`${SPACE}/notes%3Aoutline.md`)).toStrictEqual({
      knowledgeSpaceId: SPACE,
      relativePath: 'notes:outline.md',
    });
  });

  it('splits a comma selector into the list it names', () => {
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
    `${SPACE}/notes/100%.md`,
    `${SPACE}/notes/a%2Fb.md`,
    `${SPACE}//`,
    `${SPACE}//:1-2`,
    // The path part is decoded and validated before the suffix is judged: a
    // suffix on a path the Space rules refuse is `invalid_path`, never an
    // `invalid_selector` whose hint names a locator that cannot resolve.
    `${SPACE}/notes/100%.md:1-2`,
    `${SPACE}/notes/a%2Fb.md:1-2`,
    `${SPACE}/../notes/a.md:1-2`,
    `${SPACE}/notes//a.md:1-2`,
    `${SPACE}/notes/\uD800:1-2`,
    `${SPACE}/notes/\uD800:nonsense`,
  ])('refuses %s as a locator that does not parse', (rest) => {
    expect(parseKnowledgeLocator(rest)).toStrictEqual(INVALID_PATH);
  });

  it.each([
    [
      `${SPACE}/notes/:foo`,
      `kb://${SPACE}/notes/%3Afoo`,
      `${SPACE}/notes/%3Afoo`,
      'notes/:foo',
    ],
    [
      `${SPACE}/notes/:50%.md`,
      `kb://${SPACE}/notes/%3A50%25.md`,
      `${SPACE}/notes/%3A50%25.md`,
      'notes/:50%.md',
    ],
  ])(
    'keeps the trailing separator in the invalid-selector spelling for %s',
    (rest, spelling, hintedRest, relativePath) => {
      const parsed = parseKnowledgeLocator(rest);
      expect(parsed).toMatchObject({ type: 'invalid_selector' });
      expect(parsed).toHaveProperty(
        'message',
        expect.stringContaining(spelling),
      );
      expect(parseKnowledgeLocator(hintedRest)).toStrictEqual({
        knowledgeSpaceId: SPACE,
        relativePath,
      });
    },
  );

  it.each([
    [`${SPACE}/notes/a:b.md`, `kb://${SPACE}/notes/a%3Ab.md`],
    [`${SPACE}/note.md:5-10,,20-30`, `kb://${SPACE}/note.md%3A5-10,,20-30`],
    [`${SPACE}/note.md:raw:outline`, `kb://${SPACE}/note.md%3Araw%3Aoutline`],
    [`${SPACE}/note.md:outline:1,3`, `kb://${SPACE}/note.md%3Aoutline%3A1,3`],
    // The Space directory has no resource path, so nothing is spelled for it.
    [`${SPACE}/:nonsense`, undefined],
  ])('reports %s as an invalid selector', (rest, spelling) => {
    const parsed = parseKnowledgeLocator(rest);
    expect(parsed).toMatchObject({ type: 'invalid_selector' });
    if (spelling !== undefined) {
      expect(parsed).toHaveProperty(
        'message',
        expect.stringContaining(spelling),
      );
    }
  });

  it('encodes a percent in the suffix so the hint reads the same file', () => {
    // `discount:50%.md` splits at the colon, so the suffix carries a literal
    // `%`. The hint encodes it before the colon, or the locator it names
    // decodes to something else on the next attempt.
    const parsed = parseKnowledgeLocator(`${SPACE}/notes/discount:50%.md`);
    expect(parsed).toMatchObject({ type: 'invalid_selector' });
    expect(parsed).toHaveProperty(
      'message',
      expect.stringContaining(`kb://${SPACE}/notes/discount%3A50%25.md`),
    );
    expect(
      parseKnowledgeLocator(`${SPACE}/notes/discount%3A50%25.md`),
    ).toStrictEqual({
      knowledgeSpaceId: SPACE,
      relativePath: 'notes/discount:50%.md',
    });
  });

  it.each([
    [`${SPACE}/notes.md:5-`, '5-'],
    [`${SPACE}/notes.md:1-5:raw`, '1-5:raw'],
    [`${SPACE}/notes.md:raw:1-5`, 'raw:1-5'],
  ])('accepts the members and both raw spellings in %s', (rest, selector) => {
    expect(parseKnowledgeLocator(rest)).toStrictEqual({
      knowledgeSpaceId: SPACE,
      relativePath: 'notes.md',
      selector,
    });
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

  it('refuses a suffix outside the grammar with the shared message', async () => {
    // The locator before the suffix is a resource this tool can read, so the
    // suffix is what failed: the forms are named first, then the spelling that
    // reads the same resource with the colon made literal.
    const calls: Array<ResolveCall> = [];
    const result = await resolveKnowledgeLocator(
      contextWithAdapter(() => Promise.resolve(hostPath), calls),
      `kb://${SPACE}/notes/a:b.md`,
      `${SPACE}/notes/a:b.md`,
    );
    expect(result).toMatchObject({
      status: 'error',
      type: 'invalid_selector',
    });
    expect(result).toHaveProperty(
      'message',
      expect.stringContaining(`kb://${SPACE}/notes/a%3Ab.md`),
    );
    expect(calls).toStrictEqual([]);
  });

  it('refuses a suffix carrying its own colons without resolving it', async () => {
    const rest = `${SPACE}/note.md:a:b.md:41-53`;
    const calls: Array<ResolveCall> = [];
    await expect(
      resolveKnowledgeLocator(
        contextWithAdapter(() => Promise.resolve(hostPath), calls),
        `kb://${rest}`,
        rest,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'invalid_selector' });
    expect(calls).toStrictEqual([]);
  });

  it('keeps invalid_path for a malformed locator part', async () => {
    const calls: Array<ResolveCall> = [];
    await expect(
      resolveKnowledgeLocator(
        contextWithAdapter(() => Promise.resolve(hostPath), calls),
        `kb://${SPACE}/100%.md:1-2`,
        `${SPACE}/100%.md:1-2`,
      ),
    ).resolves.toStrictEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'The Knowledge locator is invalid.',
    });
    expect(calls).toStrictEqual([]);
  });

  it.each([`${SPACE}//`, `${SPACE}//:1-2`])(
    'rejects the slash-only resource path %s before resolution',
    async (rest) => {
      const calls: Array<ResolveCall> = [];
      const bindingCalls: Array<[string, string]> = [];
      await expect(
        resolveKnowledgeLocator(
          contextWithAdapter(() => Promise.resolve(hostPath), calls, {
            bindingCalls,
          }),
          `kb://${rest}`,
          rest,
        ),
      ).resolves.toMatchObject({
        status: 'error',
        type: 'invalid_path',
      });
      expect(calls).toStrictEqual([]);
      expect(bindingCalls).toStrictEqual([]);
    },
  );

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
