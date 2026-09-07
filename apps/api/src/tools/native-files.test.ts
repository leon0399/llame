import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile as readNativeFile } from '@workspace/native-file-tools';
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
import { type ToolContext } from './types';

describe('native tool admission', () => {
  const context: ToolContext = {
    userId: 'owner',
    chatId: 'chat',
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
