import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { privateDirectory, readPrivate, withPrivateLock, writePrivate } from '@workspace/personal-node/private-files';
import { authority, integer, keys, parseJson, record, uuid } from '@workspace/personal-node/validation';
import { CliError } from '@workspace/personal-node/errors';

/** Disposable UI checkpoints, not Node domain state or a database client. */
export class RemoteCursors {
  private readonly directory: string;
  constructor(directory: string) { this.directory = privateDirectory(join(directory, 'remote-cursors')); }
  private path(base: string, user: string, run: string): string {
    return join(this.directory, createHash('sha256').update(JSON.stringify([authority(base), uuid(user), uuid(run)])).digest('hex') + '.json');
  }
  cursor(base: string, user: string, run: string): number {
    const path = this.path(base, user, run); if (!existsSync(path)) return 0;
    const row = record(parseJson(readPrivate(path, 8192)), 'remote cursor');
    keys(row, ['version', 'authority', 'userId', 'runId', 'chatId', 'sequence'], 'remote cursor');
    if (row.version !== 1 || row.authority !== base || row.userId !== user || row.runId !== run) throw new CliError('cursor_identity', 'Saved cursor belongs to a different authority or account.');
    return integer(row.sequence, 'cursor', 0, Number.MAX_SAFE_INTEGER);
  }
  saveCursor(base: string, user: string, run: string, chat: string, sequence: number): void {
    const path = this.path(base, user, run);
    withPrivateLock(path, () => writePrivate(path, JSON.stringify({ version: 1, authority: authority(base),
      userId: uuid(user), runId: uuid(run), chatId: uuid(chat), sequence: Math.max(this.cursor(base, user, run), integer(sequence, 'sequence', 0, Number.MAX_SAFE_INTEGER)) })));
  }
}
