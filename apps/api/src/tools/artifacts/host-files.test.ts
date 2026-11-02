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
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../../db/schema';
import { type Db } from '../../db/tenant-db.service';
import { ArtifactsRepository } from './artifacts-repository';
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

let temporaryRoot: string;
let previousTmpdir: string | undefined;

function tenantDb() {
  const db: Db = drizzle.mock({ schema });
  return {
    runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
      callback(db),
  };
}

/** The directory `$TMPDIR/llame/chats/<chatId>` names the sweep. */
function chatRoot(chatId: string): string {
  return path.join(tmpdir(), 'llame', 'chats', chatId);
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
      parts: [
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
      ],
    },
    { maxBytes: MAX_BYTES, hostFiles: overrides.hostFiles ?? true },
  );
}

beforeEach(() => {
  previousTmpdir = process.env.TMPDIR;
  temporaryRoot = mkdtempSync(path.join(tmpdir(), 'artifact-host-files-'));
  process.env.TMPDIR = temporaryRoot;
});

afterEach(() => {
  if (previousTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = previousTmpdir;
  rmSync(temporaryRoot, { recursive: true, force: true });
});

describe('writing host files after the commit', () => {
  it('writes a bash artifact as one file for each stream', async () => {
    vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(12);
    vi.spyOn(ArtifactsRepository.prototype, 'insertArtifact').mockResolvedValue(
      { id: 'artifact-12', createdAt: CREATED_AT },
    );
    const insertParts = vi
      .spyOn(ArtifactsRepository.prototype, 'insertParts')
      .mockResolvedValue(undefined);

    const written = await write(CHAT);

    expect(insertParts).toHaveBeenCalledOnce();
    const directory = artifactDirectory(CHAT);
    expect(written.hostFiles).toEqual({
      directory: path.join(directory, 'bash-12'),
    });
    expect(readdirSync(directory)).toEqual(['bash-12']);
    const stdout = path.join(directory, 'bash-12', 'stdout.txt');
    expect(readFileSync(stdout, 'utf8')).toBe('hello\nworld\n');
    expect(
      readFileSync(path.join(directory, 'bash-12', 'stderr.txt'), 'utf8'),
    ).toBe('warning\n');
    expect(statSync(stdout).mtimeMs).toBe(CREATED_AT.getTime());
  });

  it('writes no file without the host-files capability', async () => {
    vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(12);
    vi.spyOn(ArtifactsRepository.prototype, 'insertArtifact').mockResolvedValue(
      { id: 'artifact-12', createdAt: CREATED_AT },
    );
    vi.spyOn(ArtifactsRepository.prototype, 'insertParts').mockResolvedValue(
      undefined,
    );

    const written = await write(CHAT, { hostFiles: false });

    expect(written.hostFiles).toBeUndefined();
    expect(existsSync(artifactDirectory(CHAT))).toBe(false);
  });

  it('writes a single-part artifact with its content extension', async () => {
    vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(3);
    vi.spyOn(ArtifactsRepository.prototype, 'insertArtifact').mockResolvedValue(
      { id: 'artifact-3', createdAt: CREATED_AT },
    );
    vi.spyOn(ArtifactsRepository.prototype, 'insertParts').mockResolvedValue(
      undefined,
    );

    const written = await writeArtifactHostFiles({
      chatId: CHAT,
      toolName: 'grep',
      seq: 3,
      createdAt: CREATED_AT,
      parts: [{ contentType: 'text/markdown', content: Buffer.from('# a\n') }],
    });

    expect(written).toEqual({ directory: artifactDirectory(CHAT) });
    expect(
      readFileSync(path.join(artifactDirectory(CHAT), 'grep-3.md'), 'utf8'),
    ).toBe('# a\n');
  });
});

describe('reconciling host files', () => {
  function storedPart(chatId: string, name: string, content: string) {
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

  it('writes every file again when the host lost them', async () => {
    vi.spyOn(
      ArtifactsRepository.prototype,
      'listChatPartFiles',
    ).mockResolvedValue([
      storedPart(CHAT, 'stdout', 'hello\n'),
      storedPart(CHAT, 'stderr', 'warn\n'),
    ]);
    const find = vi
      .spyOn(ArtifactsRepository.prototype, 'findPart')
      .mockResolvedValueOnce({
        name: 'stdout',
        contentType: 'text/plain',
        content: Buffer.from('hello\n'),
        lineCount: 1,
        byteSize: 6,
        findings: null,
      })
      .mockResolvedValueOnce({
        name: 'stderr',
        contentType: 'text/plain',
        content: Buffer.from('warn\n'),
        lineCount: 1,
        byteSize: 5,
        findings: null,
      });

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
    vi.spyOn(
      ArtifactsRepository.prototype,
      'listChatPartFiles',
    ).mockResolvedValue([storedPart(CHAT, 'stdout', 'hello\n')]);
    const find = vi
      .spyOn(ArtifactsRepository.prototype, 'findPart')
      .mockResolvedValue({
        name: 'stdout',
        contentType: 'text/plain',
        content: Buffer.from('hello\n'),
        lineCount: 1,
        byteSize: 6,
        findings: null,
      });
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

  it('repairs a changed file before the next bash call', async () => {
    const directory = path.join(artifactDirectory(CHAT), 'bash-12');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'stdout.txt'), 'tampered\n');
    vi.spyOn(
      ArtifactsRepository.prototype,
      'listChatPartFiles',
    ).mockResolvedValue([storedPart(CHAT, 'stdout', 'hello\n')]);
    vi.spyOn(ArtifactsRepository.prototype, 'findPart').mockResolvedValue({
      name: 'stdout',
      contentType: 'text/plain',
      content: Buffer.from('hello\n'),
      lineCount: 1,
      byteSize: 6,
      findings: null,
    });

    await reconcileArtifactFiles(context());

    expect(readFileSync(path.join(directory, 'stdout.txt'), 'utf8')).toBe(
      'hello\n',
    );
  });

  it('touches only the Chat it reconciles', async () => {
    const otherDirectory = artifactDirectory(OTHER_CHAT);
    mkdirSync(path.join(otherDirectory, 'bash-7'), { recursive: true });
    const otherFile = path.join(otherDirectory, 'bash-7', 'stdout.txt');
    writeFileSync(otherFile, 'theirs\n');
    const otherTime = new Date('2026-10-01T00:00:00.000Z');
    utimesSync(otherFile, otherTime, otherTime);
    vi.spyOn(
      ArtifactsRepository.prototype,
      'listChatPartFiles',
    ).mockResolvedValue([storedPart(CHAT, 'stdout', 'hello\n')]);
    vi.spyOn(ArtifactsRepository.prototype, 'findPart').mockResolvedValue({
      name: 'stdout',
      contentType: 'text/plain',
      content: Buffer.from('hello\n'),
      lineCount: 1,
      byteSize: 6,
      findings: null,
    });

    await reconcileArtifactFiles(context());

    expect(readFileSync(otherFile, 'utf8')).toBe('theirs\n');
    expect(statSync(otherFile).mtimeMs).toBe(otherTime.getTime());
  });
});

describe('sweeping host directories', () => {
  const NOW = new Date('2026-11-02T12:00:00.000Z');

  function seed(chatId: string, seenDaysAgo: number): string {
    const directory = chatRoot(chatId);
    mkdirSync(path.join(directory, 'artifacts', 'bash-1'), {
      recursive: true,
    });
    const seen = new Date(NOW.getTime() - seenDaysAgo * 24 * 60 * 60 * 1000);
    utimesSync(directory, seen, seen);
    return directory;
  }

  it('removes a Chat directory no attempt reconciled for seven days', async () => {
    const stale = seed(CHAT, 8);
    const live = seed(OTHER_CHAT, 1);

    await sweepArtifactDirectories(NOW);

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(live)).toBe(true);
  });

  it('keeps a directory seen within seven days', async () => {
    const boundary = seed('7f4c2b1a-9e8d-4c3b-8a7f-6e5d4c3b2a10', 7 - 1 / 24);

    await sweepArtifactDirectories(NOW);

    expect(existsSync(boundary)).toBe(true);
  });

  it('leaves an entry that is not a Chat directory', async () => {
    const directory = path.join(tmpdir(), 'llame', 'chats', 'not-a-chat');
    mkdirSync(directory, { recursive: true });
    const stale = new Date(NOW.getTime() - SWEEP_AFTER_MS * 2);
    utimesSync(directory, stale, stale);

    await sweepArtifactDirectories(NOW);

    expect(existsSync(directory)).toBe(true);
  });
});
