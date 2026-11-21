import { execFile } from 'node:child_process';
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
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { type KnowledgeFilesystemBinding } from '../knowledge/knowledge-filesystem';
import { collectStreamBytes } from '../testing/stream-collect';
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

/** A FIFO at `target`; `mkfifo` is the one reliable way to make one. */
async function makeFifo(target: string): Promise<void> {
  await promisify(execFile)('mkfifo', [target]);
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
          files: null,
          entries: null,
          bytes: null,
          maxFileBytes: null,
          deadlineMs: 30_000,
          limit: GREP_LIMITS.filesPerPage,
          pageUnits: GREP_LIMITS.pageCodeUnits,
          fixedReserve: 0,
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

  it('streams a file larger than one mebibyte through the Space', async () => {
    await withTree(async (root) => {
      const directory = path.join(root, SPACE_ID);
      await mkdir(directory, { recursive: true });
      const text = `${'x'.repeat(1024 * 1024)}tail\n`;
      await writeFile(path.join(directory, 'big.md'), text);
      const port = createKnowledgeWalkPort(bindingOf(root), '', undefined);
      const opened = await port.open('big.md');

      if (!('chunks' in opened)) throw new Error('a Space file opens');
      expect(opened.size).toBe(Buffer.byteLength(text));
      // Compare with `equals`: a deep `toEqual` on a mebibyte walks every
      // byte through the differ and costs seconds on a slow runner.
      const bytes = await collectStreamBytes(opened.chunks);
      expect(bytes.equals(Buffer.from(text))).toBe(true);
      await opened.close();
    });
  });

  it('refuses a FIFO at a leaf without blocking the walk', async () => {
    await withTree(async (root) => {
      const directory = path.join(root, SPACE_ID);
      await mkdir(directory, { recursive: true });
      await makeFifo(path.join(directory, 'pipe.md'));
      const port = createKnowledgeWalkPort(bindingOf(root), '', undefined);
      await expect(port.open('pipe.md')).resolves.toStrictEqual({
        kind: 'unreadable',
      });
    });
  });

  it('refuses a symbolic link at a component of the path', async () => {
    await withTree(async (root) => {
      const directory = path.join(root, SPACE_ID);
      await mkdir(path.join(root, 'outside'), { recursive: true });
      await writeFile(path.join(root, 'outside', 'note.md'), 'needle\n');
      await mkdir(directory, { recursive: true });
      await symlink(path.join(root, 'outside'), path.join(directory, 'notes'));
      const port = createKnowledgeWalkPort(bindingOf(root), '', undefined);
      await expect(port.open('notes/note.md')).resolves.toStrictEqual({
        kind: 'unreadable',
      });
    });
  });

  it('reads a file that vanished between the listing and the read as a skip', async () => {
    await withTree(async (root) => {
      await mkdir(path.join(root, SPACE_ID), { recursive: true });
      const port = createKnowledgeWalkPort(bindingOf(root), '', undefined);
      // The walk never fails for one file the listing named: the engine counts
      // it as an `unreadable` skip and keeps searching.
      await expect(port.open('absent.md')).resolves.toStrictEqual({
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

  it('streams the scope root itself when no relative path is given', async () => {
    await withTree(async (root) => {
      const file = path.join(root, 'SKILL.md');
      await writeFile(file, 'needle\n');
      const opened = await createSkillWalkPort(file, undefined).open('');

      if (!('chunks' in opened)) throw new Error('a package file opens');
      expect(await collectStreamBytes(opened.chunks)).toEqual(
        Buffer.from('needle\n'),
      );
    });
  });

  it('refuses a FIFO at an exact skill scope without blocking', async () => {
    await withTree(async (root) => {
      const file = path.join(root, 'SKILL.md');
      await makeFifo(file);
      await expect(
        createSkillWalkPort(file, undefined).open(''),
      ).resolves.toStrictEqual({ kind: 'unreadable' });
    });
  });

  it('streams a package file and announces its size', async () => {
    await withTree(async (root) => {
      const directory = await packageFixture(root);

      const opened = await createSkillWalkPort(directory, undefined).open(
        'SKILL.md',
      );

      if (!('chunks' in opened)) throw new Error('a package file opens');
      expect(opened.size).toBe(7);
      expect(await collectStreamBytes(opened.chunks)).toEqual(
        Buffer.from('needle\n'),
      );
    });
  });

  it('closes the handle after every read, so a scan cannot exhaust the process', async () => {
    await withTree(async (root) => {
      const directory = await packageFixture(root);
      const port = createSkillWalkPort(directory, undefined);
      const openHandles = async () => (await readdir('/proc/self/fd')).length;
      const first = await port.open('SKILL.md');

      if (!('chunks' in first)) throw new Error('a package file opens');
      expect(await collectStreamBytes(first.chunks)).toEqual(
        Buffer.from('needle\n'),
      );
      const before = await openHandles();

      for (let index = 0; index < 20; index += 1) {
        const opened = await port.open('SKILL.md');

        if (!('chunks' in opened)) throw new Error('a package file opens');
        await collectStreamBytes(opened.chunks);
      }

      await port.open('absent.md');

      expect(await openHandles()).toBeLessThanOrEqual(before + 2);
    });
  });

  it('reports a directory and an absent file as unreadable', async () => {
    await withTree(async (root) => {
      const directory = await packageFixture(root);
      const port = createSkillWalkPort(directory, undefined);

      await expect(port.open('sub')).resolves.toStrictEqual({
        kind: 'unreadable',
      });
      await expect(port.open('absent.md')).resolves.toStrictEqual({
        kind: 'unreadable',
      });
    });
  });
});
