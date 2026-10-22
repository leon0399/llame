import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { type KnowledgeFilesystemBinding } from '../knowledge/knowledge-filesystem';
import {
  compileGrepPatterns,
  GREP_LIMITS,
  runGrepScan,
} from '@workspace/native-file-tools';

import {
  createKnowledgeWalkPort,
  createSkillWalkPort,
  joinedPath,
  probeKnowledgePath,
  probeSkillPath,
  readBoundedFileBytes,
} from './grep-ports';

const SPACE_ID = '11111111-1111-4111-8111-111111111111';

async function withTree<T>(callback: (root: string) => Promise<T>): Promise<T> {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), 'grep-ports-')),
  );
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function bindingOf(root: string): KnowledgeFilesystemBinding {
  return {
    id: SPACE_ID,
    name: 'Personal',
    root,
    directory: path.join(root, SPACE_ID),
  };
}

async function packageFixture(root: string): Promise<string> {
  const directory = path.join(root, 'pdf');
  await mkdir(path.join(directory, 'sub'), { recursive: true });
  await writeFile(path.join(directory, 'SKILL.md'), 'needle\n');
  await writeFile(path.join(directory, 'sub', 'deep.md'), 'needle\n');
  await symlink(
    path.join(directory, 'SKILL.md'),
    path.join(directory, 'copy.md'),
  );
  await symlink(directory, path.join(directory, 'sub', 'up'));
  await symlink(
    path.join(directory, 'missing.md'),
    path.join(directory, 'gone.md'),
  );
  return directory;
}

describe('joinedPath', () => {
  it('joins two relative parts without a doubled separator', () => {
    expect(joinedPath('', 'a.md')).toBe('a.md');
    expect(joinedPath('notes', '')).toBe('notes');
    expect(joinedPath('notes', 'a.md')).toBe('notes/a.md');
  });
});

describe('readBoundedFileBytes', () => {
  it('reads one byte past the bound and never buffers the rest', async () => {
    const positions: Array<number> = [];
    const bytes = await readBoundedFileBytes(
      {
        read: (buffer, offset, length, position) => {
          positions.push(position);
          // Fill the chunk so the helper has to decide where to stop.
          buffer.fill(0x61, offset, offset + length);
          return Promise.resolve({ bytesRead: length });
        },
      },
      10,
      undefined,
    );

    // The extra byte is how a caller tells a file of exactly 10 from a larger
    // one, so a file far past the bound still reads only 11 bytes.
    expect(bytes.byteLength).toBe(11);
    expect(positions).toEqual([0]);
  });

  it('stops when the handle runs out of bytes and when the signal aborts', async () => {
    let reads = 0;
    const shortReads = await readBoundedFileBytes(
      {
        read: (buffer, offset, length) => {
          reads += 1;
          const bytesRead = Math.min(4, length);
          buffer.fill(0x61, offset, offset + bytesRead);
          return Promise.resolve({ bytesRead });
        },
      },
      10,
      undefined,
    );
    expect(shortReads.byteLength).toBe(11);
    expect(reads).toBe(3);

    const controller = new AbortController();
    controller.abort();
    await expect(
      readBoundedFileBytes(
        { read: () => Promise.resolve({ bytesRead: 0 }) },
        10,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('createKnowledgeWalkPort', () => {
  it('walks a link as a skip, never as a link the engine counts', async () => {
    await withTree(async (root) => {
      const directory = path.join(root, SPACE_ID);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'a.md'), 'needle\n');
      await symlink(
        path.join(directory, 'a.md'),
        path.join(directory, 'link.md'),
      );
      const port = createKnowledgeWalkPort(bindingOf(root), '', undefined);
      const patterns = compileGrepPatterns({
        patterns: ['needle'],
        literal: false,
        ignoreCase: false,
      });
      if (!patterns.ok) throw new Error('the fixture pattern compiles');

      const scan = await runGrepScan({
        scopes: [
          {
            index: 0,
            locatorPrefix: `kb://${SPACE_ID}/`,
            port,
            glob: undefined,
            singleFile: false,
            locatorFor: (rel) => `kb://${SPACE_ID}/${rel}`,
          },
        ],
        patterns: patterns.compiled,
        onCandidate: () => Promise.resolve(true),
        budget: {
          files: GREP_LIMITS.filesExamined,
          entries: GREP_LIMITS.entriesListed,
          bytes: GREP_LIMITS.bytesRead,
          deadlineMs: GREP_LIMITS.deadlineMs,
          limit: GREP_LIMITS.filesPerPage,
          pageUnits: GREP_LIMITS.pageCodeUnits,
        },
        inputHash: 'input-hash',
        now: Date.now,
      });

      expect(scan.results.map((passage) => passage.locator)).toEqual([
        `kb://${SPACE_ID}/a.md:1-1`,
      ]);
      expect(scan.warnings).toEqual([]);
    });
  });

  it('carries a listing failure as the closed result of the call', async () => {
    await withTree(async (root) => {
      const port = createKnowledgeWalkPort(
        bindingOf(root),
        'absent',
        undefined,
      );
      await expect(port.list('')).rejects.toMatchObject({
        result: { status: 'error', type: 'knowledge_space_unavailable' },
      });
    });
  });

  it('reads a file that vanished between the listing and the read as a skip', async () => {
    await withTree(async (root) => {
      await mkdir(path.join(root, SPACE_ID), { recursive: true });
      const port = createKnowledgeWalkPort(bindingOf(root), '', undefined);
      // The walk never fails for one file the listing named: the engine counts
      // it as an `unreadable` skip and keeps searching.
      await expect(port.read('absent.md', 64)).resolves.toStrictEqual({
        kind: 'unreadable',
      });
    });
  });
});

describe('probeKnowledgePath', () => {
  it('reports the kind of the prefix it probed', async () => {
    await withTree(async (root) => {
      const directory = path.join(root, SPACE_ID);
      await mkdir(path.join(directory, 'notes'), { recursive: true });
      await writeFile(path.join(directory, 'note.md'), 'needle\n');
      const binding = bindingOf(root);

      await expect(
        probeKnowledgePath(binding, 'notes', undefined),
      ).resolves.toEqual({ kind: 'directory' });
      await expect(
        probeKnowledgePath(binding, 'note.md', undefined),
      ).resolves.toEqual({ kind: 'file' });
    });
  });

  it('reports an absent prefix as missing, not as a refusal', async () => {
    await withTree(async (root) => {
      await mkdir(path.join(root, SPACE_ID), { recursive: true });
      await expect(
        probeKnowledgePath(bindingOf(root), 'absent.md', undefined),
      ).resolves.toEqual({ kind: 'missing' });
    });
  });

  it('returns any other refusal as the result that ends the call', async () => {
    await withTree(async (root) => {
      await expect(
        probeKnowledgePath(bindingOf(root), 'notes', undefined),
      ).resolves.toEqual({
        result: {
          status: 'error',
          type: 'knowledge_space_unavailable',
          message: 'The Knowledge Space is unavailable.',
        },
      });
    });
  });
});

describe('probeSkillPath', () => {
  it('names a directory, a file, and an absent path', async () => {
    await withTree(async (root) => {
      const directory = await packageFixture(root);
      await expect(probeSkillPath(directory, undefined)).resolves.toEqual({
        kind: 'directory',
      });
      await expect(
        probeSkillPath(path.join(directory, 'SKILL.md'), undefined),
      ).resolves.toEqual({ kind: 'file' });
      await expect(
        probeSkillPath(path.join(directory, 'absent'), undefined),
      ).resolves.toEqual({ kind: 'missing' });
    });
  });
});

describe('createSkillWalkPort', () => {
  it('lists a package with links resolved the way agent-skills resolves them', async () => {
    await withTree(async (root) => {
      const directory = await packageFixture(root);
      const port = createSkillWalkPort(directory, undefined);

      const entries = [...(await port.list(''))].sort((left, right) =>
        left.name < right.name ? -1 : 1,
      );

      expect(port.followsLinks).toBe(true);
      expect(entries).toStrictEqual([
        { name: 'SKILL.md', kind: 'file' },
        { name: 'copy.md', kind: 'file' },
        { name: 'gone.md', kind: 'link' },
        {
          name: 'sub',
          kind: 'directory',
          identity: path.join(directory, 'sub'),
        },
      ]);
    });
  });

  it('counts a link back to an ancestor as a link instead of entering it', async () => {
    await withTree(async (root) => {
      const directory = await packageFixture(root);
      const port = createSkillWalkPort(directory, undefined);

      await expect(port.list('sub')).resolves.toStrictEqual([
        { name: 'deep.md', kind: 'file' },
        { name: 'up', kind: 'link' },
      ]);
    });
  });

  it('reads the scope root itself when no relative path is given', async () => {
    await withTree(async (root) => {
      const file = path.join(root, 'SKILL.md');
      await writeFile(file, 'needle\n');
      await expect(
        createSkillWalkPort(file, undefined).read('', 64),
      ).resolves.toEqual(Buffer.from('needle\n'));
    });
  });

  it('returns the file bytes, and an oversized file as a refusal', async () => {
    await withTree(async (root) => {
      const directory = await packageFixture(root);
      const port = createSkillWalkPort(directory, undefined);

      // The bound is inclusive: a file exactly at it still reads.
      await expect(port.read('SKILL.md', 7)).resolves.toEqual(
        Buffer.from('needle\n'),
      );
      await expect(port.read('SKILL.md', 6)).resolves.toStrictEqual({
        kind: 'oversized',
      });
    });
  });

  it('refuses bytes a file grew past its declared size to', async () => {
    // procfs reports size 0 for a file with content, which is the one input
    // that separates the declared size from the bytes actually read.
    await expect(
      createSkillWalkPort('/proc/self/status', undefined).read('', 0),
    ).resolves.toStrictEqual({ kind: 'oversized' });
  });

  it('closes the handle after every read, so a scan cannot exhaust the process', async () => {
    await withTree(async (root) => {
      const directory = await packageFixture(root);
      const port = createSkillWalkPort(directory, undefined);
      const openHandles = async () => (await readdir('/proc/self/fd')).length;
      expect(await port.read('SKILL.md', 64)).toEqual(Buffer.from('needle\n'));
      const before = await openHandles();

      for (let index = 0; index < 20; index += 1) {
        await port.read('SKILL.md', 64);
      }
      await port.read('absent.md', 64);

      expect(await openHandles()).toBeLessThanOrEqual(before + 2);
    });
  });

  it('reports a directory and an absent file as unreadable', async () => {
    await withTree(async (root) => {
      const directory = await packageFixture(root);
      const port = createSkillWalkPort(directory, undefined);

      await expect(port.read('sub', 1)).resolves.toStrictEqual({
        kind: 'unreadable',
      });
      await expect(port.read('absent.md', 64)).resolves.toStrictEqual({
        kind: 'unreadable',
      });
    });
  });
});
