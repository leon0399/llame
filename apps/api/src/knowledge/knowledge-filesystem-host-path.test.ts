import path from 'node:path';

import { KnowledgeFilesystemError } from './knowledge-filesystem-errors';
import {
  type KnowledgeHostPathPort,
  resolveKnowledgeHostPath,
} from './knowledge-filesystem-host-path';
import { type KnowledgeFilesystemStats } from './knowledge-filesystem';

const DIRECTORY = '/srv/knowledge/6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e';

type EntryKind = 'directory' | 'file' | 'symlink';

function statsFor(kind: EntryKind): KnowledgeFilesystemStats {
  return {
    size: 0,
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
    isSymbolicLink: () => kind === 'symlink',
  };
}

type Recorder = { lstat: Array<string>; mkdir: Array<string> };

/** A port over a fixed entry map; anything absent reports `knowledge_not_found`
 *  the way the real adapter maps `ENOENT`. `mkdir` adds a directory, so the
 *  post-creation `lstat` sees what creation actually produced. */
function portOver(
  entries: Map<string, EntryKind>,
  recorder: Recorder,
): KnowledgeHostPathPort {
  return {
    lstat: (filePath) => {
      recorder.lstat.push(filePath);
      const kind = entries.get(filePath);
      return kind === undefined
        ? Promise.reject(new KnowledgeFilesystemError('knowledge_not_found'))
        : Promise.resolve(statsFor(kind));
    },
    mkdir: (directoryPath) => {
      recorder.mkdir.push(directoryPath);
      entries.set(directoryPath, 'directory');
      return Promise.resolve();
    },
  };
}

function recorder(): Recorder {
  return { lstat: [], mkdir: [] };
}

describe('Knowledge host path resolution', () => {
  it('returns the Space directory itself when no path is given', async () => {
    const calls = recorder();
    await expect(
      resolveKnowledgeHostPath(
        DIRECTORY,
        undefined,
        portOver(new Map(), calls),
      ),
    ).resolves.toBe(DIRECTORY);
    expect(calls.lstat).toStrictEqual([]);
  });

  it('lstats every component on the way to the target', async () => {
    const calls = recorder();
    const entries = new Map<string, EntryKind>([
      [path.join(DIRECTORY, 'notes'), 'directory'],
      [path.join(DIRECTORY, 'notes', 'note.md'), 'file'],
    ]);
    await expect(
      resolveKnowledgeHostPath(
        DIRECTORY,
        'notes/note.md',
        portOver(entries, calls),
      ),
    ).resolves.toBe(path.join(DIRECTORY, 'notes', 'note.md'));
    expect(calls.lstat).toStrictEqual([
      path.join(DIRECTORY, 'notes'),
      path.join(DIRECTORY, 'notes', 'note.md'),
    ]);
  });

  // The link is refused rather than followed, and it is refused as absent so
  // the answer cannot distinguish a link from a missing note.
  it.each(['notes', 'notes/note.md'])(
    'refuses a symbolic link at %s without following it',
    async (linked) => {
      const calls = recorder();
      const entries = new Map<string, EntryKind>([
        [path.join(DIRECTORY, 'notes'), 'directory'],
        [path.join(DIRECTORY, ...linked.split('/')), 'symlink'],
      ]);
      await expect(
        resolveKnowledgeHostPath(
          DIRECTORY,
          'notes/note.md',
          portOver(entries, calls),
        ),
      ).rejects.toMatchObject({ code: 'knowledge_not_found' });
    },
  );

  it('refuses a non-directory component above the target', async () => {
    const calls = recorder();
    const entries = new Map<string, EntryKind>([
      [path.join(DIRECTORY, 'notes'), 'file'],
    ]);
    await expect(
      resolveKnowledgeHostPath(
        DIRECTORY,
        'notes/note.md',
        portOver(entries, calls),
      ),
    ).rejects.toMatchObject({ code: 'knowledge_not_directory' });
  });

  it('refuses a missing component when absence is not tolerated', async () => {
    const calls = recorder();
    await expect(
      resolveKnowledgeHostPath(
        DIRECTORY,
        'notes/note.md',
        portOver(new Map(), calls),
      ),
    ).rejects.toMatchObject({ code: 'knowledge_not_found' });
    expect(calls.mkdir).toStrictEqual([]);
  });

  it('joins the remainder unchecked once a component is missing', async () => {
    const calls = recorder();
    await expect(
      resolveKnowledgeHostPath(
        DIRECTORY,
        'notes/deep/note.md',
        portOver(new Map(), calls),
        { allowMissing: true },
      ),
    ).resolves.toBe(path.join(DIRECTORY, 'notes', 'deep', 'note.md'));
    expect(calls.lstat).toStrictEqual([path.join(DIRECTORY, 'notes')]);
    expect(calls.mkdir).toStrictEqual([]);
  });

  // One component at a time, never a recursive create: a recursive `mkdir`
  // treats an existing link as satisfied and builds the rest through it.
  it('creates only the missing directories above the leaf', async () => {
    const calls = recorder();
    await expect(
      resolveKnowledgeHostPath(
        DIRECTORY,
        'notes/deep/note.md',
        portOver(new Map(), calls),
        { allowMissing: true, createDirectories: true },
      ),
    ).resolves.toBe(path.join(DIRECTORY, 'notes', 'deep', 'note.md'));
    expect(calls.mkdir).toStrictEqual([
      path.join(DIRECTORY, 'notes'),
      path.join(DIRECTORY, 'notes', 'deep'),
    ]);
  });

  // The re-`lstat` after creation is what makes a lost race visible; a create
  // that yielded a link is still refused.
  it('refuses a directory that lost the creation race to a link', async () => {
    const calls = recorder();
    const entries = new Map<string, EntryKind>();
    const port = portOver(entries, calls);
    const racing: KnowledgeHostPathPort = {
      lstat: (filePath) => port.lstat(filePath),
      mkdir: (directoryPath) => {
        calls.mkdir.push(directoryPath);
        entries.set(directoryPath, 'symlink');
        return Promise.resolve();
      },
    };
    await expect(
      resolveKnowledgeHostPath(DIRECTORY, 'notes/note.md', racing, {
        allowMissing: true,
        createDirectories: true,
      }),
    ).rejects.toMatchObject({ code: 'knowledge_not_found' });
  });

  it('stops at the first abort check', async () => {
    const calls = recorder();
    const controller = new AbortController();
    controller.abort();
    await expect(
      resolveKnowledgeHostPath(
        DIRECTORY,
        'notes/note.md',
        portOver(new Map(), calls),
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'knowledge_cancelled' });
    expect(calls.lstat).toStrictEqual([]);
  });
});
