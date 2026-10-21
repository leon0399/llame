import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  KnowledgeFilesystemAdapter,
  KnowledgeFilesystemError,
  type KnowledgeFilesystemBinding,
} from '../knowledge/knowledge-filesystem';
import { type KnowledgeSpaceCursor } from '../knowledge/knowledge-space.cursor';
import { type GrepReadAdmission } from './grep-admission';
import { resolveKnowledgeScope } from './grep-knowledge-scope';
import { type ScopeOutcome } from './grep-scope-shape';
import { type KnowledgeToolResolver, type ToolContext } from './types';

const SPACE_A = '11111111-1111-4111-8111-111111111111';
const SPACE_B = '22222222-2222-4222-8222-222222222222';

const admission: GrepReadAdmission = {
  admit: () => true,
  refused: 0,
  recordRefusals() {},
};

function resolverFor(
  bindings: ReadonlyMap<string, KnowledgeFilesystemBinding>,
  pages?: (after: KnowledgeSpaceCursor | undefined) => {
    spaces: ReadonlyArray<{ id: string; name: string; createdAt: Date }>;
    nextCursor?: KnowledgeSpaceCursor;
  },
): KnowledgeToolResolver {
  return {
    listForOwnerPage: (_owner, after) =>
      Promise.resolve(pages?.(after) ?? { spaces: [] }),
    resolveBindingForOwnerById: (_owner, id) =>
      Promise.resolve(bindings.get(id)),
    createAdapter: (binding) => new KnowledgeFilesystemAdapter(binding),
  };
}

function contextOf(resolver?: KnowledgeToolResolver): ToolContext {
  return {
    userId: 'owner-a',
    chatId: 'chat-a',
    tenantDb: { runAs: () => Promise.reject(new Error('unused')) },
    knowledgeResolver: resolver,
  };
}

/** Two owner Spaces with the same content, so a bare scope can span them. */
async function withSpace<T>(
  files: Readonly<Record<string, string>>,
  callback: (
    binding: KnowledgeFilesystemBinding,
    both: ReadonlyMap<string, KnowledgeFilesystemBinding>,
  ) => Promise<T>,
): Promise<T> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'grep-kb-')));
  try {
    const bindings = new Map<string, KnowledgeFilesystemBinding>();
    for (const id of [SPACE_A, SPACE_B]) {
      const directory = path.join(root, id);
      await mkdir(directory, { recursive: true });
      for (const [relative, content] of Object.entries(files)) {
        const target = path.join(directory, ...relative.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content);
      }
      bindings.set(id, { id, name: id, root, directory });
    }
    const first = bindings.get(SPACE_A);
    if (first === undefined)
      throw new Error('the fixture builds a first Space');
    return await callback(first, bindings);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function scopesOf(outcome: ScopeOutcome) {
  if ('result' in outcome) {
    throw new Error(`expected scopes, received ${outcome.result.type}`);
  }
  return outcome;
}

describe('resolveKnowledgeScope', () => {
  it('resolves a bare Space scope to its root locator', async () => {
    await withSpace({ 'notes/a.md': 'needle\n' }, async (binding) => {
      const outcome = scopesOf(
        await resolveKnowledgeScope(
          contextOf(resolverFor(new Map([[SPACE_A, binding]]))),
          SPACE_A,
          0,
          admission,
        ),
      );

      expect(outcome.roots).toEqual([SPACE_A]);
      expect(outcome.scopes[0]).toMatchObject({
        locatorPrefix: `kb://${SPACE_A}/`,
        singleFile: false,
      });
      expect(outcome.scopes[0]?.locatorFor('')).toBe(`kb://${SPACE_A}`);
      expect(outcome.scopes[0]?.locatorFor('notes/a.md')).toBe(
        `kb://${SPACE_A}/notes/a.md`,
      );
    });
  });

  it('expands a bare scope over every page of Spaces in byte order', async () => {
    await withSpace({ 'a.md': 'needle\n' }, async (_binding, both) => {
      const seen: Array<KnowledgeSpaceCursor | undefined> = [];
      const resolver = resolverFor(both, (after) => {
        seen.push(after);
        if (after === undefined) {
          return {
            spaces: [{ id: SPACE_B, name: 'B', createdAt: new Date(0) }],
            nextCursor: { id: SPACE_B, createdAt: new Date(0) },
          };
        }
        return {
          spaces: [{ id: SPACE_A, name: 'A', createdAt: new Date(1) }],
        };
      });

      const outcome = scopesOf(
        await resolveKnowledgeScope(contextOf(resolver), '', 0, admission),
      );

      expect(seen).toHaveLength(2);
      expect(outcome.roots).toEqual([SPACE_A, SPACE_B]);
      expect(outcome.scopes.map((scope) => scope.index)).toEqual([0, 0]);
    });
  });

  it('refuses a glob in the Space identifier', async () => {
    const outcome = await resolveKnowledgeScope(
      contextOf(resolverFor(new Map())),
      '*/notes',
      0,
      admission,
    );
    expect(outcome).toEqual({
      result: {
        status: 'error',
        type: 'invalid_path',
        message: 'A Knowledge Space identifier cannot hold a glob.',
      },
    });
  });

  it('refuses a malformed identifier before any owner lookup', async () => {
    const lookup = vi.fn(() => Promise.resolve(undefined));
    const resolver: KnowledgeToolResolver = {
      listForOwnerPage: () => Promise.resolve({ spaces: [] }),
      resolveBindingForOwnerById: lookup,
      createAdapter: (binding) => new KnowledgeFilesystemAdapter(binding),
    };

    expect(
      await resolveKnowledgeScope(
        contextOf(resolver),
        'not-a-uuid',
        0,
        admission,
      ),
    ).toEqual({
      result: {
        status: 'error',
        type: 'knowledge_space_not_found',
        message: 'Knowledge Space was not found.',
      },
    });
    // An empty identifier is absent, not an empty glob.
    expect(
      await resolveKnowledgeScope(contextOf(resolver), '/*', 0, admission),
    ).toEqual({
      result: {
        status: 'error',
        type: 'knowledge_space_not_found',
        message: 'Knowledge Space was not found.',
      },
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a colon instead of parsing a read selector', async () => {
    const outcome = await resolveKnowledgeScope(
      contextOf(resolverFor(new Map())),
      `${SPACE_A}/notes/a.md:3-5`,
      0,
      admission,
    );
    expect(outcome).toEqual({
      result: {
        status: 'error',
        type: 'invalid_path',
        message:
          'Write a literal colon in a kb:// scope as %3A; grep parses no selector.',
      },
    });
  });

  it('refuses a path its Space rules cannot address', async () => {
    const outcome = await resolveKnowledgeScope(
      contextOf(resolverFor(new Map())),
      `${SPACE_A}/../x`,
      0,
      admission,
    );
    expect(outcome).toEqual({
      result: {
        status: 'error',
        type: 'invalid_path',
        message: 'The scope path is invalid.',
      },
    });
  });

  it('reports an unusable resolver as a Space that is not configured', async () => {
    expect(await resolveKnowledgeScope(contextOf(), '', 0, admission)).toEqual({
      result: {
        status: 'error',
        type: 'knowledge_space_unavailable',
        message: 'The Knowledge Space is unavailable.',
      },
    });
  });

  it.each([
    ['an unknown failure', new Error('database is down')],
    [
      'an unusable Space',
      new KnowledgeFilesystemError('knowledge_space_unavailable'),
    ],
    [
      'a cancellation code without the error type',
      Object.assign(new Error('cancelled'), { code: 'knowledge_cancelled' }),
    ],
  ])('reports %s as an unavailable Space', async (_label, failure) => {
    const resolver: KnowledgeToolResolver = {
      listForOwnerPage: () => Promise.reject(failure),
      resolveBindingForOwnerById: () => Promise.resolve(undefined),
      createAdapter: (binding) => new KnowledgeFilesystemAdapter(binding),
    };

    expect(
      await resolveKnowledgeScope(contextOf(resolver), '', 0, admission),
    ).toEqual({
      result: {
        status: 'error',
        type: 'knowledge_space_unavailable',
        message: 'The Knowledge Space is unavailable.',
      },
    });
  });

  it('propagates a cancelled Space listing', async () => {
    const resolver: KnowledgeToolResolver = {
      listForOwnerPage: () =>
        Promise.reject(new KnowledgeFilesystemError('knowledge_cancelled')),
      resolveBindingForOwnerById: () => Promise.resolve(undefined),
      createAdapter: (binding) => new KnowledgeFilesystemAdapter(binding),
    };

    await expect(
      resolveKnowledgeScope(contextOf(resolver), '', 0, admission),
    ).rejects.toMatchObject({ code: 'knowledge_cancelled' });
  });
});
