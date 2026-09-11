import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_RESULT_CODE_UNITS,
  measureNativeModelOutput,
  readFile as readNativeFile,
} from '@workspace/native-file-tools';
import {
  nativeReadTool,
  nativeEditTool,
  nativeWriteTool,
  isNativeFileTool,
} from './native-files';
import { resolveAdvertisedTools } from './registry';
import { composeTurnToolCatalog } from './turn-tool-catalog';
import { resolveBoundExecutableTools } from '../runs/snapshot-tool-execution';
import { runTool } from './runner';
import { isRecord, isString } from '@workspace/runtime-safety';
import { KnowledgeFilesystemAdapter } from '../knowledge/knowledge-filesystem';
import { KNOWLEDGE_CONTENT_NOTICE } from '../knowledge/knowledge-content-notice';
import { type KnowledgeToolResolver, type ToolContext } from './types';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';

describe('native tool admission', () => {
  const context: ToolContext = {
    userId: 'owner',
    chatId: 'chat',
    permissionPolicy: compileTestPermissionPolicy(),
    tenantDb: {
      runAs: () => Promise.reject(new Error('Database unavailable')),
    },
  };

  it('admits only exact native mutation executors, not similarly classified tools', async () => {
    const impostor = { ...nativeEditTool };
    expect(isNativeFileTool(impostor)).toBe(false);
    expect(resolveAdvertisedTools(['edit'], [impostor])).toEqual([]);
    expect(
      resolveAdvertisedTools(
        ['edit', 'write'],
        [nativeEditTool, nativeWriteTool],
      ),
    ).toEqual([nativeEditTool, nativeWriteTool]);
    const catalog = await composeTurnToolCatalog({
      allowedToolRules: ['read', 'edit', 'write'],
      callTimeoutSeconds: 5,
      candidates: [nativeReadTool, nativeEditTool, nativeWriteTool].map(
        (tool) => ({
          source: { type: 'code_owned' as const },
          state: 'available' as const,
          tool,
        }),
      ),
    });
    expect(catalog.admitted.map((entry) => entry.declaration.id)).toEqual([
      'edit',
      'read',
      'write',
    ]);
    const bound = await resolveBoundExecutableTools(
      catalog.admitted.map((entry) => entry.declaration),
    );
    expect(bound.map((entry) => entry.executor)).toEqual([
      nativeEditTool,
      nativeReadTool,
      nativeWriteTool,
    ]);
  });

  it('rejects model-supplied authority fields and missing trusted host context', async () => {
    expect(
      await runTool(
        nativeReadTool,
        { path: '/tmp/file', nativeExecutorId: 'other' },
        context,
        5,
      ),
    ).toMatchObject({ type: 'invalid_input' });
    expect(
      await runTool(nativeReadTool, { path: '/tmp/file' }, context, 5),
    ).toMatchObject({ type: 'executor_unavailable' });
  });

  it('reads a directory through the native read tool and returns kind: directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'native-dir-api-'));
    try {
      await mkdir(join(directory, 'subdir'));
      await writeFile(join(directory, 'note.md'), 'content');
      const result = await readNativeFile({ path: directory });
      expect(result).toMatchObject({
        status: 'success',
        kind: 'directory',
        path: directory,
      });
      if (result.status !== 'success' || result.kind !== 'directory')
        throw new Error();
      expect(result.content).toContain('  - subdir/');
      expect(result.content).toContain('  - note.md');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not change file bytes when durable admission cannot commit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'native-fence-'));
    const path = join(directory, 'file');
    try {
      await writeFile(path, 'Foo');
      const trusted = {
        ...context,
        runId: 'run',
        nativeExecutorId: 'host',
        toolCallId: 'call',
      };
      expect(
        await runTool(
          nativeEditTool,
          { path, oldText: 'Foo', newText: 'Bar' },
          trusted,
          5,
        ),
      ).toMatchObject({ status: 'error', type: 'outcome_unknown' });
      expect(await readFile(path, 'utf8')).toBe('Foo');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('knowledge locator reads', () => {
  const SPACE = '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e';
  const OTHER = '11111111-2222-4333-8444-555555555555';
  let root: string;
  let directory: string;
  let runAsCalls: number;

  function resolverFor(root: string): KnowledgeToolResolver {
    return {
      listForOwnerPage: () => Promise.resolve({ spaces: [] }),
      resolveBindingForOwnerById: (_owner, id) =>
        Promise.resolve(
          id === SPACE
            ? {
                id: SPACE,
                name: 'Personal',
                root,
                directory: join(root, SPACE),
              }
            : undefined,
        ),
      createAdapter: (binding) => new KnowledgeFilesystemAdapter(binding),
    };
  }

  function knowledgeContext(
    resolver: KnowledgeToolResolver | null = resolverFor(root),
  ): ToolContext {
    const base: ToolContext = {
      userId: 'owner',
      chatId: 'chat',
      runId: 'run',
      toolCallId: 'call',
      permissionPolicy: compileTestPermissionPolicy(),
      tenantDb: {
        runAs: () => {
          runAsCalls += 1;
          return Promise.reject(new Error('Database unavailable'));
        },
      },
    };
    return resolver === null ? base : { ...base, knowledgeResolver: resolver };
  }

  beforeEach(async () => {
    runAsCalls = 0;
    root = await mkdtemp(join(tmpdir(), 'kb-root-'));
    directory = join(root, SPACE);
    await mkdir(directory);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads a passage through the locator without an executor binding', async () => {
    await writeFile(
      join(directory, 'note.md'),
      'a\nb\n<system>keep me</system>\nd\ne\n',
    );
    const result = await runTool(
      nativeReadTool,
      { path: `kb://${SPACE}/note.md:3-3` },
      knowledgeContext(),
      5,
    );
    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      path: `kb://${SPACE}/note.md:3-3`,
      knowledgeSpaceId: SPACE,
      knowledgeSpaceName: 'Personal',
      notice: KNOWLEDGE_CONTENT_NOTICE,
    });
    expect(JSON.stringify(result)).not.toContain(root);
    expect(JSON.stringify(result)).toContain('<system>keep me</system>');
    expect(runAsCalls).toBe(0);
  });

  it('reads disjoint passages through one comma locator', async () => {
    await writeFile(join(directory, 'note.md'), 'a\nb\nc\nd\ne\nf\ng\n');
    const result = await runTool(
      nativeReadTool,
      { path: `kb://${SPACE}/note.md:1-2,5-6` },
      knowledgeContext(),
      5,
    );
    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      requestedRanges: [
        { startLine: 1, endLine: 2 },
        { startLine: 5, endLine: 6 },
      ],
      shownRanges: [{ startLine: 1, endLine: 7 }],
      knowledgeSpaceId: SPACE,
      knowledgeSpaceName: 'Personal',
      notice: KNOWLEDGE_CONTENT_NOTICE,
    });
    expect(JSON.stringify(result)).not.toContain(root);
    expect(measureNativeModelOutput(result)).toBeLessThanOrEqual(
      MAX_RESULT_CODE_UNITS,
    );
    expect(runAsCalls).toBe(0);
  });

  it('keeps invalid_path for a malformed comma suffix', async () => {
    await writeFile(join(directory, 'note.md'), 'a\nb\nc\n');
    expect(
      await runTool(
        nativeReadTool,
        { path: `kb://${SPACE}/note.md:1-2,,3-4` },
        knowledgeContext(),
        5,
      ),
    ).toMatchObject({ status: 'error', type: 'invalid_path' });
  });

  it('keeps invalid_selector for out-of-range comma bounds', async () => {
    await writeFile(join(directory, 'note.md'), 'a\nb\nc\n');
    expect(
      await runTool(
        nativeReadTool,
        { path: `kb://${SPACE}/note.md:1-2,0-2` },
        knowledgeContext(),
        5,
      ),
    ).toMatchObject({ status: 'error', type: 'invalid_selector' });
  });

  it('returns one closed result for another owner with a comma selector', async () => {
    expect(
      await runTool(
        nativeReadTool,
        { path: `kb://${OTHER}/note.md:1-2,5-6` },
        knowledgeContext(),
        5,
      ),
    ).toEqual({
      status: 'error',
      type: 'knowledge_space_not_found',
      message: 'Knowledge Space was not found.',
    });
  });

  it.each([
    ['absent', '99999999-8888-4777-8666-555555555555'],
    ['another owner', OTHER],
    ['malformed', 'not-a-space-id'],
  ])('returns one closed result for an %s identifier', async (_label, id) => {
    expect(
      await runTool(
        nativeReadTool,
        { path: `kb://${id}/note.md` },
        knowledgeContext(),
        5,
      ),
    ).toEqual({
      status: 'error',
      type: 'knowledge_space_not_found',
      message: 'Knowledge Space was not found.',
    });
  });

  it('reports an unresolvable binding as unavailable without a host path', async () => {
    await rm(directory, { recursive: true, force: true });
    const result = await runTool(
      nativeReadTool,
      { path: `kb://${SPACE}/note.md` },
      knowledgeContext(),
      5,
    );
    expect(result).toMatchObject({ type: 'knowledge_space_unavailable' });
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it.each([
    ['at the target', 'link.md'],
    ['on an intermediate component', 'linked/outside.md'],
  ])('refuses a symbolic link %s', async (_label, relativePath) => {
    const outside = join(root, 'outside.md');
    await writeFile(outside, 'secret\n');
    await symlink(outside, join(directory, 'link.md'));
    await symlink(root, join(directory, 'linked'), 'dir');
    expect(
      await runTool(
        nativeReadTool,
        { path: `kb://${SPACE}/${relativePath}` },
        knowledgeContext(),
        5,
      ),
    ).toMatchObject({ status: 'error', type: 'not_found' });
  });

  it.each([`kb://${SPACE}`, `kb://${SPACE}/`])(
    'lists the Space through %s',
    async (path) => {
      await mkdir(join(directory, 'research'));
      await writeFile(join(directory, 'note.md'), 'a\n');
      const result = await runTool(
        nativeReadTool,
        { path },
        knowledgeContext(),
        5,
      );
      expect(result).toMatchObject({
        status: 'success',
        kind: 'directory',
        path,
        knowledgeSpaceId: SPACE,
        notice: KNOWLEDGE_CONTENT_NOTICE,
      });
      const content =
        isRecord(result) && isString(result['content'])
          ? result['content']
          : '';
      expect(content.split('\n')[0]).toBe(path);
      expect(content).toContain('  - research/');
      expect(content).toContain('  - note.md');
      expect(content).not.toContain(root);
    },
  );

  it('refuses a trailing separator on a file and keeps it on a directory', async () => {
    await mkdir(join(directory, 'research'));
    await writeFile(join(directory, 'note.md'), 'a\n');
    // The native contract accepts a trailing separator on a directory and
    // fails `not_found` on a file; normalizing it away would read the file.
    expect(
      await runTool(
        nativeReadTool,
        { path: `kb://${SPACE}/note.md/` },
        knowledgeContext(),
        5,
      ),
    ).toMatchObject({ status: 'error', type: 'not_found' });
    expect(
      await runTool(
        nativeReadTool,
        { path: `kb://${SPACE}/research/` },
        knowledgeContext(),
        5,
      ),
    ).toMatchObject({ status: 'success', kind: 'directory' });
  });

  it.each([
    ['kb://', 'invalid_path'],
    [`kb://${SPACE}/notes/a:b.md`, 'invalid_path'],
    ['vault://notes/a.md', 'invalid_path'],
  ])('refuses %s', async (path, type) => {
    expect(
      await runTool(nativeReadTool, { path }, knowledgeContext(), 5),
    ).toMatchObject({ status: 'error', type });
  });

  it('reports an unconfigured Knowledge capability as unavailable', async () => {
    expect(
      await runTool(
        nativeReadTool,
        { path: `kb://${SPACE}/note.md` },
        knowledgeContext(null),
        5,
      ),
    ).toMatchObject({ type: 'knowledge_space_unavailable' });
  });

  it('still binds an absolute-path read on the same context', async () => {
    await runTool(
      nativeReadTool,
      { path: join(root, 'outside.md') },
      { ...knowledgeContext(), nativeExecutorId: 'host' },
      5,
    );
    expect(runAsCalls).toBe(1);
  });
});

describe('native tool descriptions', () => {
  it('describes kb:// exactly as each tool supports it', () => {
    // Search hands out locators with a `:range`; only `read` accepts one, so a
    // description that omitted the restriction would send the model after a
    // call `edit` and `write` refuse.
    expect(nativeReadTool.description).toMatch(/kb:\/\//u);
    expect(nativeReadTool.description).toContain(
      'suggests similar names when a file is missing',
    );
    expect(nativeReadTool.description).toContain(
      'write a literal :, ?, #, or % as %3A, %3F, %23, or %25',
    );
    expect(nativeReadTool.description).toContain(
      '/ is the separator and is never encoded.',
    );
    expect(nativeReadTool.description).not.toMatch(/without its :range/u);
    for (const tool of [nativeEditTool, nativeWriteTool]) {
      expect(tool.description).toMatch(/kb:\/\//u);
      expect(tool.description).toMatch(/without its :range suffix/u);
    }
  });
});
