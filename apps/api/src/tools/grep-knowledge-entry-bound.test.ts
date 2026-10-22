/**
 * The Knowledge walk's entry bound, end to end: a Space whose directory holds
 * more entries than one call may list is a partial page with an `entry_bound`
 * warning, never a refused call (grep-tool spec, "Walks are bounded").
 *
 * The fixture is 20,001 links because the bound is a fixed number of listed
 * entries and a link is counted without being opened. It lives in its own file
 * so the tree is built once, in a module graph that holds nothing else.
 */

import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  KnowledgeFilesystemAdapter,
  type KnowledgeFilesystemBinding,
} from '../knowledge/knowledge-filesystem';
import { grepInputSchema, nativeGrepTool } from './grep';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import {
  type KnowledgeToolResolver,
  type ToolContext,
  type ToolResult,
} from './types';

const SPACE_ID = '11111111-1111-4111-8111-111111111111';

function contextOf(binding: KnowledgeFilesystemBinding): ToolContext {
  const resolver: KnowledgeToolResolver = {
    listForOwnerPage: () =>
      Promise.resolve({
        spaces: [{ id: SPACE_ID, name: 'Personal', createdAt: new Date(0) }],
      }),
    resolveBindingForOwnerById: (_owner, id) =>
      Promise.resolve(id === SPACE_ID ? binding : undefined),
    createAdapter: (bound) => new KnowledgeFilesystemAdapter(bound),
  };
  return {
    userId: 'owner-a',
    chatId: 'chat-a',
    permissionPolicy: compileToolPermissionMap(
      { grep: { allow: true }, read: { allow: true } },
      'test',
    ),
    tenantDb: {
      runAs: () =>
        Promise.reject(new Error('grep never opens a tenant transaction')),
    },
    knowledgeResolver: resolver,
  };
}

async function run(context: ToolContext, args: unknown): Promise<ToolResult> {
  const parsed = grepInputSchema.safeParse(args);
  if (!parsed.success) throw new Error('the fixture arguments must parse');
  return nativeGrepTool.execute(context, parsed.data);
}

describe('Knowledge entry bound', () => {
  it('stops at the bound with entry_bound instead of failing the call', async () => {
    const root = await realpath(
      await mkdtemp(path.join(tmpdir(), 'llame-grep-bound-')),
    );
    try {
      const directory = path.join(root, SPACE_ID);
      const bulk = path.join(directory, 'bulk');
      await mkdir(bulk, { recursive: true });
      await writeFile(path.join(bulk, 'target.md'), 'needle\n');
      // A link is listed and counted without being opened, so 20,001 of them
      // reach the entry bound with no file read. The target stays relative:
      // an absolute one is stored out of line and makes the fixture slow.
      await Promise.all(
        Array.from({ length: 20_001 }, (_value, index) =>
          symlink('target.md', path.join(bulk, `link-${String(index)}`)),
        ),
      );
      const binding: KnowledgeFilesystemBinding = {
        id: SPACE_ID,
        name: 'Personal',
        root,
        directory,
      };

      const result = await run(contextOf(binding), {
        patterns: ['needle'],
        scopes: [`kb://${SPACE_ID}`],
      });

      expect(result).toMatchObject({
        status: 'success',
        results: [],
        complete: false,
      });
      expect(result).toMatchObject({
        warnings: [{ kind: 'entry_bound', count: 1 }],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
