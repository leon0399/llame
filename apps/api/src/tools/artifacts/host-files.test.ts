/**
 * Host files of tool-result artifacts (tool-result-artifacts D10): a `bash`
 * artifact is written under `$TMPDIR/llame/chats/<chatId>/artifacts/` after the
 * commit, reconciled by size and modification time, and swept after seven days.
 * Every test runs in its own `$TMPDIR`.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../../db/schema';
import { type Db } from '../../db/tenant-db.service';
import { ArtifactsRepository, type ChatPartFile } from './artifacts-repository';
import { writeToolArtifact } from './artifact-writer';
import {
  artifactDirectory,
  reconcileArtifactFiles,
  SWEEP_AFTER_MS,
  sweepArtifactDirectories,
  writeArtifactHostFiles,
} from './host-files';

const CHAT = '0b0b2a2e-7a7f-4a53-9d0e-2f2f6a3c3b11';
const OTHER_CHAT = '5d0e9d9e-9a5f-4cbb-8a0f-6c4a1f6a2e77';
const CREATED_AT = new Date('2026-11-02T12:00:00.000Z');
const MAX_BYTES = 8 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

let temporaryRoot: string;

function tenantDb() {
  const db: Db = drizzle.mock({ schema });
  return {
    runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
      callback(db),
  };
}

/** Directories the writer would create, at the mode it creates them. */
function mkdirPrivate(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

/** The directory `$TMPDIR/llame/chats/<chatId>` names the sweep. */
function chatRoot(chatId: string): string {
  return path.join(tmpdir(), 'llame', 'chats', chatId);
}

/** The two bash streams as the writer takes them. */
function bashParts() {
  return [
    {
      name: 'stdout',
      contentType: 'text/plain',
      content: Buffer.from('hello\nworld\n'),
    },
    {
      name: 'stderr',
      contentType: 'text/plain',
      content: Buffer.from('warning\n'),
    },
  ];
}

function write(chatId: string, overrides: { hostFiles?: boolean } = {}) {
  return writeToolArtifact(
    tenantDb(),
    {
      chatId,
      userId: 'owner',
      runId: 'run-1',
      toolCallId: 'call-1',
      toolName: 'bash',
      complete: true,
      parts: bashParts(),
    },
    { maxBytes: MAX_BYTES, hostFiles: overrides.hostFiles ?? true },
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  temporaryRoot = mkdtempSync(path.join(tmpdir(), 'artifact-host-files-'));
  vi.stubEnv('TMPDIR', temporaryRoot);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(temporaryRoot, { recursive: true, force: true });
});

describe('writing host files after the commit', () => {
  beforeEach(() => {
    vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(12);
    vi.spyOn(ArtifactsRepository.prototype, 'insertArtifact').mockResolvedValue(
      { id: 'artifact-12', createdAt: CREATED_AT },
    );
    vi.spyOn(ArtifactsRepository.prototype, 'insertParts').mockResolvedValue(
      undefined,
    );
  });

  it('writes a bash artifact as one file for each stream', async () => {
    const written = await write(CHAT);

    const directory = artifactDirectory(CHAT);
    expect(written.hostDirectory).toBe(path.join(directory, 'bash-12'));
    expect(readdirSync(directory)).toEqual(['bash-12']);
    const stdout = path.join(directory, 'bash-12', 'stdout.txt');
    expect(readFileSync(stdout, 'utf8')).toBe('hello\nworld\n');
    expect(
      readFileSync(path.join(directory, 'bash-12', 'stderr.txt'), 'utf8'),
    ).toBe('warning\n');
    expect(statSync(stdout).mtimeMs).toBe(CREATED_AT.getTime());
  });

  it('writes no file without the host-files capability', async () => {
    const written = await write(CHAT, { hostFiles: false });

    expect(written.hostDirectory).toBeUndefined();
    expect(existsSync(artifactDirectory(CHAT))).toBe(false);
  });

  it('writes a single-part artifact with its content extension', async () => {
    const directory = await writeArtifactHostFiles({
      chatId: CHAT,
      toolName: 'grep',
      seq: 3,
      createdAt: CREATED_AT,
      parts: [
        {
          name: '',
          contentType: 'text/markdown',
          content: Buffer.from('# a\n'),
        },
      ],
    });

    expect(directory).toBe(artifactDirectory(CHAT));
    expect(
      readFileSync(path.join(artifactDirectory(CHAT), 'grep-3.md'), 'utf8'),
    ).toBe('# a\n');
  });

  it('gives a JSON part the .json extension', async () => {
    await writeArtifactHostFiles({
      chatId: CHAT,
      toolName: 'bash',
      seq: 4,
      createdAt: CREATED_AT,
      parts: [
        {
          name: 'stdout',
          contentType: 'application/json',
          content: Buffer.from('{"a":1}\n'),
        },
      ],
    });

    expect(
      readFileSync(
        path.join(artifactDirectory(CHAT), 'bash-4', 'stdout.json'),
        'utf8',
      ),
    ).toBe('{"a":1}\n');
  });

  it('writes nothing when the host root is a symbolic link', async () => {
    const real = mkdtempSync(path.join(temporaryRoot, 'real-'));
    symlinkSync(real, path.join(temporaryRoot, 'llame'));

    const written = await write(CHAT);

    expect(written.hostDirectory).toBeUndefined();
    expect(readdirSync(real)).toEqual([]);
  });

  it('writes nothing when the host root is not private', async () => {
    mkdirPrivate(path.join(temporaryRoot, 'llame', 'chats'));
    // A group- or other-readable root is another user's to list and replace.
    await chmod(path.join(temporaryRoot, 'llame'), 0o755);

    const written = await write(CHAT);

    expect(written.hostDirectory).toBeUndefined();
  });

  it('refuses a path that leaves the Chat directory', async () => {
    const written = await writeArtifactHostFiles({
      chatId: '../escape',
      toolName: 'bash',
      seq: 1,
      createdAt: CREATED_AT,
      parts: bashParts(),
    });

    expect(written).toBeUndefined();
    expect(existsSync(path.join(temporaryRoot, 'escape'))).toBe(false);
  });
});

describe('reconciling host files', () => {
  function storedPart(name: string, content: string): ChatPartFile {
    return {
      artifactId: 'artifact-12',
      toolName: 'bash',
      seq: 12,
      createdAt: CREATED_AT,
      name,
      contentType: 'text/plain',
      byteSize: Buffer.byteLength(content),
    };
  }

  function context(chatId = CHAT) {
    return { tenantDb: tenantDb(), userId: 'owner', chatId };
  }

  function scriptParts(parts: ReadonlyArray<ChatPartFile>): void {
    vi.spyOn(
      ArtifactsRepository.prototype,
      'listChatPartFiles',
    ).mockResolvedValue([...parts]);
  }

  it('writes every file again when the host lost them', async () => {
    scriptParts([
      storedPart('stdout', 'hello\n'),
      storedPart('stderr', 'warn\n'),
    ]);
    const find = vi
      .spyOn(ArtifactsRepository.prototype, 'findPartContent')
      .mockResolvedValueOnce(Buffer.from('hello\n'))
      .mockResolvedValueOnce(Buffer.from('warn\n'));

    await reconcileArtifactFiles(context());

    expect(find).toHaveBeenCalledTimes(2);
    const directory = path.join(artifactDirectory(CHAT), 'bash-12');
    expect(readFileSync(path.join(directory, 'stdout.txt'), 'utf8')).toBe(
      'hello\n',
    );
    expect(readFileSync(path.join(directory, 'stderr.txt'), 'utf8')).toBe(
      'warn\n',
    );
  });

  it('fetches no content for a file that matches', async () => {
    scriptParts([storedPart('stdout', 'hello\n')]);
    const find = vi
      .spyOn(ArtifactsRepository.prototype, 'findPartContent')
      .mockResolvedValue(Buffer.from('hello\n'));
    await writeArtifactHostFiles({
      chatId: CHAT,
      toolName: 'bash',
      seq: 12,
      createdAt: CREATED_AT,
      parts: [
        {
          name: 'stdout',
          contentType: 'text/plain',
          content: Buffer.from('hello\n'),
        },
      ],
    });
    find.mockClear();

    await reconcileArtifactFiles(context());

    expect(find).not.toHaveBeenCalled();
  });

  it('repairs a file whose size matches but whose time changed', async () => {
    scriptParts([storedPart('stdout', 'hello\n')]);
    const stdout = path.join(artifactDirectory(CHAT), 'bash-12', 'stdout.txt');
    mkdirPrivate(path.dirname(stdout));
    writeFileSync(stdout, 'hellO\n');
    const later = new Date(CREATED_AT.getTime() + 5000);
    utimesSync(stdout, later, later);
    const find = vi
      .spyOn(ArtifactsRepository.prototype, 'findPartContent')
      .mockResolvedValue(Buffer.from('hello\n'));

    await reconcileArtifactFiles(context());

    expect(find).toHaveBeenCalledOnce();
    expect(readFileSync(stdout, 'utf8')).toBe('hello\n');
  });

  it('repairs a file whose size changed at the stored time', async () => {
    scriptParts([storedPart('stdout', 'hello\n')]);
    const stdout = path.join(artifactDirectory(CHAT), 'bash-12', 'stdout.txt');
    mkdirPrivate(path.dirname(stdout));
    writeFileSync(stdout, 'tampered\n');
    utimesSync(stdout, CREATED_AT, CREATED_AT);
    vi.spyOn(
      ArtifactsRepository.prototype,
      'findPartContent',
    ).mockResolvedValue(Buffer.from('hello\n'));

    await reconcileArtifactFiles(context());

    expect(readFileSync(stdout, 'utf8')).toBe('hello\n');
  });

  it('touches only the Chat it reconciles', async () => {
    const otherDirectory = artifactDirectory(OTHER_CHAT);
    mkdirPrivate(path.join(otherDirectory, 'bash-7'));
    const otherFile = path.join(otherDirectory, 'bash-7', 'stdout.txt');
    writeFileSync(otherFile, 'theirs\n');
    const otherTime = new Date('2026-10-01T00:00:00.000Z');
    utimesSync(otherFile, otherTime, otherTime);
    scriptParts([storedPart('stdout', 'hello\n')]);
    vi.spyOn(
      ArtifactsRepository.prototype,
      'findPartContent',
    ).mockResolvedValue(Buffer.from('hello\n'));

    await reconcileArtifactFiles(context());

    expect(readFileSync(otherFile, 'utf8')).toBe('theirs\n');
    expect(statSync(otherFile).mtimeMs).toBe(otherTime.getTime());
  });

  it('marks the Chat directory as seen', async () => {
    scriptParts([storedPart('stdout', 'hello\n')]);
    vi.spyOn(
      ArtifactsRepository.prototype,
      'findPartContent',
    ).mockResolvedValue(Buffer.from('hello\n'));
    const seen = new Date('2026-10-01T00:00:00.000Z');
    mkdirPrivate(chatRoot(CHAT));
    utimesSync(chatRoot(CHAT), seen, seen);

    await reconcileArtifactFiles(context());

    expect(statSync(chatRoot(CHAT)).mtimeMs).toBeGreaterThan(
      seen.getTime() + DAY_MS,
    );
  });

  it('repairs the other parts when one cannot be read', async () => {
    scriptParts([
      storedPart('stdout', 'hello\n'),
      storedPart('stderr', 'warn\n'),
    ]);
    vi.spyOn(ArtifactsRepository.prototype, 'findPartContent')
      .mockRejectedValueOnce(new Error('the store refused the read'))
      .mockResolvedValueOnce(Buffer.from('warn\n'));
    const seen = new Date('2026-10-01T00:00:00.000Z');
    mkdirPrivate(chatRoot(CHAT));
    utimesSync(chatRoot(CHAT), seen, seen);

    await reconcileArtifactFiles(context());

    expect(
      readFileSync(
        path.join(artifactDirectory(CHAT), 'bash-12', 'stderr.txt'),
        'utf8',
      ),
    ).toBe('warn\n');
    expect(statSync(chatRoot(CHAT)).mtimeMs).toBeGreaterThan(
      seen.getTime() + DAY_MS,
    );
  });

  it('reads no part when the host root is not private', async () => {
    mkdirPrivate(path.join(temporaryRoot, 'llame', 'chats'));
    await chmod(path.join(temporaryRoot, 'llame'), 0o755);
    const list = vi.spyOn(ArtifactsRepository.prototype, 'listChatPartFiles');

    await reconcileArtifactFiles(context());

    expect(list).not.toHaveBeenCalled();
  });
});

describe('sweeping host directories', () => {
  const NOW = new Date('2026-11-02T12:00:00.000Z');

  function seed(chatId: string, seen: Date): string {
    const directory = chatRoot(chatId);
    mkdirPrivate(path.join(directory, 'artifacts', 'bash-1'));
    utimesSync(directory, seen, seen);
    return directory;
  }

  it('removes a Chat directory no attempt reconciled for seven days', async () => {
    const stale = seed(CHAT, new Date(NOW.getTime() - 8 * DAY_MS));
    const live = seed(OTHER_CHAT, new Date(NOW.getTime() - DAY_MS));

    await sweepArtifactDirectories(NOW);

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(live)).toBe(true);
  });

  it('keeps a directory seen exactly seven days ago and removes a millisecond more', async () => {
    const boundary = seed(CHAT, new Date(NOW.getTime() - SWEEP_AFTER_MS));
    const stale = seed(
      OTHER_CHAT,
      new Date(NOW.getTime() - SWEEP_AFTER_MS - 1),
    );

    await sweepArtifactDirectories(NOW);

    expect(existsSync(boundary)).toBe(true);
    expect(existsSync(stale)).toBe(false);
  });

  it('leaves an entry that is not a Chat directory', async () => {
    const directory = path.join(tmpdir(), 'llame', 'chats', 'not-a-chat');
    mkdirPrivate(directory);
    const stale = new Date(NOW.getTime() - SWEEP_AFTER_MS * 2);
    utimesSync(directory, stale, stale);

    await sweepArtifactDirectories(NOW);

    expect(existsSync(directory)).toBe(true);
  });

  it('removes nothing when the host root is a symbolic link', async () => {
    const real = mkdtempSync(path.join(temporaryRoot, 'real-'));
    const chat = path.join(real, CHAT);
    mkdirPrivate(chat);
    const stale = new Date(NOW.getTime() - 8 * DAY_MS);
    utimesSync(chat, stale, stale);
    symlinkSync(real, path.join(temporaryRoot, 'llame'));

    await sweepArtifactDirectories(NOW);

    expect(existsSync(chat)).toBe(true);
  });
});
