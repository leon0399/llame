import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { statHostPath } from '@workspace/native-file-tools';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { nativeReadTool } from '../tools/native-files';
import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
import { type CompiledPolicy } from '../tools/permissions/types';
import { runTool } from '../tools/runner';
import { type ToolContext, type ToolResult } from '../tools/types';
import {
  readInstructionFile,
  selectCandidates,
  touchedDirectory,
  walkDirectories,
  type InstructionCandidate,
  type ReadPage,
} from './instruction-files';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'llame-instructions-'));
  vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
    undefined,
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

function readingContext(permissionPolicy: CompiledPolicy): ToolContext {
  const db: Db = drizzle.mock({ schema });
  return {
    userId: 'owner',
    chatId: 'chat',
    runId: 'run',
    nativeExecutorId: 'host',
    nativeDeliverySequence: 1,
    toolCallId: 'call',
    permissionPolicy,
    tenantDb: {
      runAs: async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    },
  };
}

/** The real native `read` tool behind the page seam, as the producer uses it. */
function nativePageReader(
  permissionPolicy: CompiledPolicy = compileTestPermissionPolicy(),
): ReadPage {
  const context = readingContext(permissionPolicy);
  return (selectorPath) =>
    runTool(nativeReadTool, { path: selectorPath }, context, 30);
}

async function candidateOf(file: string): Promise<InstructionCandidate> {
  const probe = await statHostPath(file);
  if (probe.kind === 'missing') throw new Error(`missing fixture ${file}`);
  return { path: file, canonicalPath: probe.canonicalPath, size: probe.size };
}

describe('walkDirectories', () => {
  it('lists the filesystem root down to the directory', () => {
    expect(walkDirectories('/a/b/c')).toEqual(['/', '/a', '/a/b', '/a/b/c']);
  });

  it('lists only the root for the root directory', () => {
    expect(walkDirectories('/')).toEqual(['/']);
  });
});

describe('touchedDirectory', () => {
  it('returns an existing directory itself', async () => {
    const nested = join(root, 'apps', 'api');
    await mkdir(nested, { recursive: true });

    expect(await touchedDirectory(nested, statHostPath)).toBe(nested);
  });

  it('returns the parent of a file', async () => {
    const file = join(root, 'AGENTS.md');
    await writeFile(file, '# Rules\n');

    expect(await touchedDirectory(file, statHostPath)).toBe(root);
  });

  it('returns the parent of a path that does not exist', async () => {
    const missing = join(root, 'apps', 'web', 'src', 'new.tsx');

    expect(await touchedDirectory(missing, statHostPath)).toBe(
      join(root, 'apps', 'web', 'src'),
    );
  });
});

describe('selectCandidates', () => {
  it('prefers LLAME.md over AGENTS.md', async () => {
    const llame = join(root, 'LLAME.md');
    await writeFile(llame, '# Llame\n');
    await writeFile(join(root, 'AGENTS.md'), '# Agents\n');

    expect(await selectCandidates(root, statHostPath)).toEqual([
      { path: llame, canonicalPath: await realpath(llame), size: 8 },
    ]);
  });

  it('selects AGENTS.override.md before AGENTS.md', async () => {
    const override = join(root, 'AGENTS.override.md');
    await writeFile(override, 'override\n');
    await writeFile(join(root, 'AGENTS.md'), 'base\n');
    await writeFile(join(root, 'CLAUDE.override.md'), 'claude override\n');
    await writeFile(join(root, 'CLAUDE.md'), 'claude\n');

    expect(await selectCandidates(root, statHostPath)).toEqual([
      {
        path: override,
        canonicalPath: await realpath(override),
        size: 9,
      },
    ]);
  });

  it('prefers LLAME.override.md over LLAME.md and AGENTS.md', async () => {
    const override = join(root, 'LLAME.override.md');
    await writeFile(override, 'override\n');
    await writeFile(join(root, 'LLAME.md'), '# Llame\n');
    await writeFile(join(root, 'AGENTS.md'), '# Agents\n');

    const candidates = await selectCandidates(root, statHostPath);

    expect(candidates.map((candidate) => candidate.path)).toEqual([override]);
  });

  it('loads a local file beside the base file, base first', async () => {
    const base = join(root, 'AGENTS.md');
    const local = join(root, 'CLAUDE.local.md');
    await writeFile(base, '# Agents\n');
    await writeFile(local, '# Local\n');

    const candidates = await selectCandidates(root, statHostPath);

    expect(candidates.map((candidate) => candidate.path)).toEqual([
      base,
      local,
    ]);
  });

  it('selects the first local name independently of the base chain', async () => {
    const base = join(root, 'LLAME.md');
    const local = join(root, 'LLAME.local.md');
    await writeFile(base, '# Llame\n');
    await writeFile(local, '# Local\n');
    await writeFile(join(root, 'AGENTS.local.md'), '# Other local\n');

    const candidates = await selectCandidates(root, statHostPath);

    expect(candidates.map((candidate) => candidate.path)).toEqual([
      base,
      local,
    ]);
  });

  it('skips a directory named like a candidate and continues the chain', async () => {
    const claude = join(root, 'CLAUDE.md');
    await mkdir(join(root, 'AGENTS.md'));
    await writeFile(claude, '# Claude\n');

    expect(await selectCandidates(root, statHostPath)).toEqual([
      { path: claude, canonicalPath: await realpath(claude), size: 9 },
    ]);
  });

  it('selects an empty file and suppresses later names', async () => {
    const empty = join(root, 'LLAME.md');
    await writeFile(empty, '');
    await writeFile(join(root, 'AGENTS.md'), '# Agents\n');

    expect(await selectCandidates(root, statHostPath)).toEqual([
      { path: empty, canonicalPath: await realpath(empty), size: 0 },
    ]);
  });

  it('keeps a symlink candidate path and its target canonical path', async () => {
    const target = join(root, 'dotfiles', 'AGENTS.md');
    await mkdir(join(root, 'dotfiles'));
    await writeFile(target, '# Shared\n');
    await symlink(target, join(root, 'AGENTS.md'));

    expect(await selectCandidates(root, statHostPath)).toEqual([
      {
        path: join(root, 'AGENTS.md'),
        canonicalPath: await realpath(target),
        size: 9,
      },
    ]);
  });
});

describe('readInstructionFile', () => {
  it('loads a small file whole without line prefixes', async () => {
    const file = join(root, 'AGENTS.md');
    const body = '# Rules\n\nDo the thing.\n';
    await writeFile(file, body);

    const result = await readInstructionFile(
      await candidateOf(file),
      nativePageReader(),
    );

    expect(result).toEqual({
      kind: 'loaded',
      content: body,
      truncated: false,
      omittedBytes: 0,
    });
  });

  it('pages a 20 KiB file and joins it into one body', async () => {
    const file = join(root, 'AGENTS.md');
    const line = `${'a'.repeat(1023)}\n`;
    const body = line.repeat(20);
    await writeFile(file, body);
    const readPage = nativePageReader();
    let pages = 0;
    const counting: ReadPage = (path) => {
      pages += 1;
      return readPage(path);
    };

    const result = await readInstructionFile(await candidateOf(file), counting);

    expect(result).toEqual({
      kind: 'loaded',
      content: body,
      truncated: false,
      omittedBytes: 0,
    });
    expect(pages).toBe(2);
  });

  it('cuts a 40 KiB multi-byte file at 32 KiB in bytes', async () => {
    const file = join(root, 'AGENTS.md');
    const line = `a${'é'.repeat(1023)}\n`;
    const body = line.repeat(20);
    await writeFile(file, body);

    const result = await readInstructionFile(
      await candidateOf(file),
      nativePageReader(),
    );

    expect(result).toEqual({
      kind: 'loaded',
      content: line.repeat(16),
      truncated: true,
      omittedBytes: 8 * 1024,
    });
  });

  it('cuts before a character that would cross the byte limit', async () => {
    const file = join(root, 'AGENTS.md');
    const filler = `${'a'.repeat(99)}\n`;
    const straddle = `${'a'.repeat(66)}€${'a'.repeat(9)}\n`;
    const body = filler.repeat(327) + straddle;
    await writeFile(file, body);

    const result = await readInstructionFile(
      await candidateOf(file),
      nativePageReader(),
    );

    expect(result).toEqual({
      kind: 'loaded',
      content: filler.repeat(327) + 'a'.repeat(66),
      truncated: true,
      omittedBytes: Buffer.byteLength(body, 'utf8') - 32_766,
    });
  });

  it('stops when one line cannot fit a result', async () => {
    const file = join(root, 'AGENTS.md');
    const body = `first\nsecond\n${'x'.repeat(20_000)}\nthird\n`;
    await writeFile(file, body);

    const result = await readInstructionFile(
      await candidateOf(file),
      nativePageReader(),
    );

    expect(result).toEqual({
      kind: 'loaded',
      content: 'first\nsecond\n',
      truncated: true,
      omittedBytes: Buffer.byteLength(body, 'utf8') - 13,
    });
  });

  it('denies a file a reject rule names', async () => {
    const file = join(root, 'AGENTS.md');
    await writeFile(file, '# Rules\n');
    const policy = compileToolPermissionMap(
      {
        read: {
          allow: true,
          reject: [{ field: 'path', regex: `^${file}:raw:` }],
        },
      },
      'reject-instruction-file',
    );

    const result = await readInstructionFile(
      await candidateOf(file),
      nativePageReader(policy),
    );

    expect(result).toEqual({ kind: 'denied' });
  });

  it('fails a missing file', async () => {
    const missing = join(root, 'AGENTS.md');

    const result = await readInstructionFile(
      { path: missing, canonicalPath: missing, size: 7 },
      nativePageReader(),
    );

    expect(result).toEqual({ kind: 'failed' });
  });

  it('treats an invalid selector on a continuation page as the end', async () => {
    const pages: Array<ToolResult> = [
      {
        status: 'success',
        kind: 'file',
        path: '/srv/AGENTS.md',
        content: 'hello\n',
        nextOffset: 1,
        truncated: true,
      },
      { status: 'error', type: 'invalid_selector', message: 'No such line.' },
    ];
    const readPage: ReadPage = () => {
      const page = pages.shift();
      if (page === undefined) throw new Error('unexpected page request');
      return Promise.resolve(page);
    };

    const result = await readInstructionFile(
      { path: '/srv/AGENTS.md', canonicalPath: '/srv/AGENTS.md', size: 6 },
      readPage,
    );

    expect(result).toEqual({
      kind: 'loaded',
      content: 'hello\n',
      truncated: false,
      omittedBytes: 0,
    });
  });
});
