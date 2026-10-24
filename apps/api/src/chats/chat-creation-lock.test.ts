import { type Db } from '../db/tenant-db.service';
import { asDouble } from '../testing/support';
import {
  CREATION_IN_PROGRESS,
  ChatCreationLock,
  chatCreationLockKey,
  creationInProgress,
  tryCreationTransactionLock,
} from './chat-creation-lock';

/*
 * The per-Chat creation lock (openspec `chat-start-location`, "Creation
 * serializes requests for one chat id" and "The message route refuses a chat
 * that a create request holds").
 *
 * The database's own advisory locks are the integration suite's proof; here the
 * two callers' shared key, the refusal shape, and the reserved connection's
 * lifecycle are what the code owns, so one fake connection records them.
 */

const CHAT_ID = '3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10';

/** A `postgres` client double: a tagged-template function with `reserve`. */
type FakeClient = {
  readonly sql: unknown;
  readonly statements: Array<string>;
  readonly releases: Array<string>;
};

function fakeClient(answer: { locked: boolean }): FakeClient {
  const statements: Array<string> = [];
  const releases: Array<string> = [];
  const reserved = vi.fn((strings: TemplateStringsArray) => {
    const statement = strings.join('?');
    statements.push(statement);
    return Promise.resolve([{ locked: answer.locked }]);
  });
  const sql = Object.assign(vi.fn(), {
    reserve: vi.fn(() =>
      Promise.resolve(
        Object.assign(reserved, {
          release: () => releases.push('released'),
        }),
      ),
    ),
  });
  return { sql, statements, releases };
}

function lockOf(client: FakeClient) {
  return new ChatCreationLock(asDouble({ $client: client.sql }));
}

describe('chatCreationLockKey', () => {
  it('names its family so a Chat id never collides with an org-unit key', () => {
    expect(chatCreationLockKey(CHAT_ID)).toBe(`chat-creation:${CHAT_ID}`);
  });
});

describe('creationInProgress', () => {
  it('is a 409 naming the body code both routes answer', () => {
    expect(creationInProgress()).toMatchObject({
      status: 409,
      response: {
        statusCode: 409,
        code: CREATION_IN_PROGRESS,
        error: 'Conflict',
      },
    });
    expect(CREATION_IN_PROGRESS).toBe('creation_in_progress');
  });
});

describe('tryCreationTransactionLock', () => {
  it('reports the database’s verdict, taking the lock once per transaction', async () => {
    const execute = vi.fn(() => Promise.resolve([{ locked: false }]));
    const tx = asDouble<Db>({ execute });

    await expect(tryCreationTransactionLock(tx, CHAT_ID)).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('treats an empty result as not locked', async () => {
    const tx = asDouble<Db>({ execute: () => Promise.resolve([]) });

    await expect(tryCreationTransactionLock(tx, CHAT_ID)).resolves.toBe(false);
  });
});

describe('ChatCreationLock.runExclusively', () => {
  it('reserves one connection, locks, runs, unlocks, and releases', async () => {
    const client = fakeClient({ locked: true });
    const order: Array<string> = [];

    await expect(
      lockOf(client).runExclusively(CHAT_ID, () => {
        order.push('run');
        return Promise.resolve('done');
      }),
    ).resolves.toBe('done');

    expect(order).toEqual(['run']);
    expect(client.statements).toHaveLength(2);
    expect(client.statements[0]).toContain('pg_try_advisory_lock');
    expect(client.statements[1]).toContain('pg_advisory_unlock');
    expect(client.releases).toEqual(['released']);
  });

  it('refuses an overlapping request and never runs it', async () => {
    const client = fakeClient({ locked: false });
    const run = vi.fn(() => Promise.resolve('never'));

    await expect(
      lockOf(client).runExclusively(CHAT_ID, run),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: CREATION_IN_PROGRESS },
    });
    expect(run).not.toHaveBeenCalled();
    // No lock was taken, so no unlock is due — but the connection goes back.
    expect(client.statements).toHaveLength(1);
    expect(client.releases).toEqual(['released']);
  });

  it('unlocks and releases when the request throws', async () => {
    const client = fakeClient({ locked: true });

    await expect(
      lockOf(client).runExclusively(CHAT_ID, () =>
        Promise.reject(new Error('the worktree add failed')),
      ),
    ).rejects.toThrow('the worktree add failed');

    expect(client.statements[1]).toContain('pg_advisory_unlock');
    expect(client.releases).toEqual(['released']);
  });
});
