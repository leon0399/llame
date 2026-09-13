/**
 * Unit tests for recordAcceptanceEvidence (#154). Proves the acceptance
 * transaction records the POST-BIND digest state (a freshly re-read chat
 * row), the advanced revision, and the compaction reference, with the
 * documented fallbacks.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { type SQL } from 'drizzle-orm';

import {
  type Chat,
  type Compaction,
  type Message,
  type Run,
} from '../db/schema';
import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type RecencyDigestDelta } from './recency-digest.service';
import { ChatsRepository, CompactionsRepository } from './chats-repository';
import {
  MessageTurnContextsRepository,
  recordAcceptanceEvidence,
} from './message-turn-contexts-repository';

const chatId = 'chat-1';
const ownerUserId = 'owner-1';

function compaction(id: string): Compaction {
  return {
    id,
    chatId,
    uptoSeq: 1,
    parentId: null,
    summary: 'summary',
    replacementHistory: [],
    usage: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    usageOriginKind: null,
    usageOriginId: null,
    usageProvenanceCol: null,
    contextRevision: null,
    sourceMaxSeq: null,
    companionActiveCompactionId: null,
    companionDigestRebakedFrom: null,
    companionState: null,
  };
}

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: chatId,
    ownerUserId,
    title: null,
    visibility: 'private',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    archivedAt: null,
    projectId: null,
    recencyDigestBaseline: null,
    recencyDigestTold: null,
    recencyDigestRebakedFrom: null,
    inheritedContextOriginAt: null,
    contextRevision: 4,
    initialContinuationState: null,
    initialActiveCompactionId: null,
    initialDigestRebakedFrom: null,
    ...overrides,
  };
}

const userMessage: Message = {
  id: 'message-1',
  chatId,
  seq: 7,
  role: 'user',
  senderUserId: ownerUserId,
  parts: [],
  attachments: [],
  usage: null,
  inReplyTo: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  inheritedTurnComplete: false,
  usageOriginKind: null,
  usageOriginId: null,
  usageProvenanceCol: null,
};

const run: Run = {
  id: 'run-1',
  chatId,
  messageId: 'message-1',
  userId: ownerUserId,
  modelId: 'model-1',
  modelContextSnapshotId: 'snapshot-1',
  status: 'running_model',
  workerId: null,
  cancelRequestedAt: null,
  error: null,
  contextItems: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  startedAt: null,
  finishedAt: null,
  effort: null,
};

const input = {
  chatId,
  userId: ownerUserId,
  modelId: 'model-1',
  effort: 'high',
};

function setup(options?: {
  fresh?: Chat | undefined;
  compactionId?: string;
  digestDelta?: RecencyDigestDelta | null;
}) {
  const tx: Db = drizzle.mock({ schema });
  const chatsRepo = new ChatsRepository(tx);
  const advanceRevision = vi
    .spyOn(ChatsRepository.prototype, 'advanceContextRevision')
    .mockResolvedValue(undefined);
  vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(
    options?.fresh,
  );
  vi.spyOn(
    CompactionsRepository.prototype,
    'findLatestByChatId',
  ).mockResolvedValue(
    options?.compactionId ? compaction(options.compactionId) : undefined,
  );
  const create = vi
    .spyOn(MessageTurnContextsRepository.prototype, 'create')
    .mockResolvedValue(undefined);

  return { tx, chatsRepo, create, advanceRevision };
}

describe('recordAcceptanceEvidence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records the post-bind digest state and advances the revision', async () => {
    const baseline: Chat['recencyDigestBaseline'] = {
      pinned: [],
      recent: [],
      pinnedShown: 0,
      pinnedTotal: 0,
      recentShown: 0,
      recentTotal: 0,
      compiledOn: '2026-08-01',
    };
    const fresh = chat({
      contextRevision: 5,
      recencyDigestBaseline: baseline,
      recencyDigestTold: [{ chatId: 'other', pinned: false }],
      recencyDigestRebakedFrom: 'comp-9',
    });
    const { tx, chatsRepo, create, advanceRevision } = setup({ fresh });

    await recordAcceptanceEvidence({
      tx,
      chatsRepo,
      chat: chat(),
      input,
      run,
      userMessage,
      digestDelta: null,
    });

    // The revision is advanced to nextRevision (4 + 1).
    expect(advanceRevision).toHaveBeenCalledWith(chatId, ownerUserId, 5);
    // The digest state comes from the RE-READ row, not the stale snapshot.
    expect(create.mock.calls[0][0]).toMatchObject({
      digestBaseline: baseline,
      digestTold: [{ chatId: 'other', pinned: false }],
      digestRebakedFrom: 'comp-9',
      contextRevision: 5,
    });
  });

  it('prefers the disclosed digest delta over the stored told-set', async () => {
    const told = [{ chatId: 'newly-told', pinned: false }];
    const { tx, chatsRepo, create } = setup({
      fresh: chat({ recencyDigestTold: [{ chatId: 'stale', pinned: false }] }),
      digestDelta: { entries: [], pinChanges: [], told },
    });

    await recordAcceptanceEvidence({
      tx,
      chatsRepo,
      chat: chat(),
      input,
      run,
      userMessage,
      digestDelta: { entries: [], pinChanges: [], told },
    });

    expect(create.mock.calls[0][0].digestTold).toEqual(told);
  });

  it('records the active compaction reference when one exists', async () => {
    const { tx, chatsRepo, create } = setup({
      fresh: chat(),
      compactionId: 'comp-active',
    });

    await recordAcceptanceEvidence({
      tx,
      chatsRepo,
      chat: chat(),
      input,
      run,
      userMessage,
      digestDelta: null,
    });

    expect(create.mock.calls[0][0].activeCompactionId).toBe('comp-active');
  });

  it('records null state when the chat row is absent', async () => {
    const { tx, chatsRepo, create } = setup({
      fresh: undefined,
    });

    await recordAcceptanceEvidence({
      tx,
      chatsRepo,
      chat: chat(),
      input,
      run,
      userMessage,
      digestDelta: null,
    });

    expect(create.mock.calls[0][0]).toMatchObject({
      digestBaseline: null,
      digestTold: null,
      digestRebakedFrom: null,
      activeCompactionId: null,
    });
  });

  it('binds the run identity, model, effort, and source boundary', async () => {
    const { tx, chatsRepo, create } = setup({ fresh: chat() });

    await recordAcceptanceEvidence({
      tx,
      chatsRepo,
      chat: chat(),
      input,
      run,
      userMessage,
      digestDelta: null,
    });

    expect(create.mock.calls[0][0]).toMatchObject({
      chatId,
      originRunId: 'run-1',
      messageId: 'message-1',
      ownerUserId,
      modelId: 'model-1',
      effort: 'high',
      snapshotId: 'snapshot-1',
      sourceMaxSeq: 7,
    });
  });

  it('records a null effort when the turn resolved none', async () => {
    const { tx, chatsRepo, create } = setup({ fresh: chat() });

    await recordAcceptanceEvidence({
      tx,
      chatsRepo,
      chat: chat(),
      input: { ...input, effort: undefined },
      run,
      userMessage,
      digestDelta: null,
    });

    expect(create.mock.calls[0][0].effort).toBeNull();
  });
});

type EvidenceInsert = typeof schema.messageTurnContexts.$inferInsert;
type EvidenceUpdate = Partial<EvidenceInsert>;

/**
 * Minimal Drizzle chain stand-in. The repository exercises only
 * `.values(...)`/`.set(...)` then `.returning()`, so the fake resolves
 * those to a terminal promise and hands the payload to `onPayload`.
 */
function queryResult<T>(
  rows: ReadonlyArray<T>,
  onPayload?: (value: EvidenceInsert | EvidenceUpdate) => void,
  onWhere?: (predicate: SQL) => void,
) {
  const terminal = Promise.resolve(rows);
  const returning = () => terminal;
  return Object.assign(terminal, {
    values: (value: EvidenceInsert) => {
      onPayload?.(value);
      return Object.assign(terminal, { returning });
    },
    set: (value: EvidenceUpdate) => {
      onPayload?.(value);
      return Object.assign(terminal, {
        where: (predicate: SQL) => {
          onWhere?.(predicate);
          return Object.assign(terminal, { returning });
        },
      });
    },
  });
}

function asQuery(value: ReturnType<typeof queryResult<unknown>>): never {
  // SAFETY: the repository tests replace Drizzle's fluent terminal with a
  // Promise carrying exactly the chain methods exercised by these methods.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return value as never;
}

describe('MessageTurnContextsRepository writes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inserts every acceptance-evidence field from the input', async () => {
    const captured: Array<EvidenceInsert | EvidenceUpdate> = [];
    const db: Db = drizzle.mock({ schema });
    vi.spyOn(db, 'insert').mockImplementation(() =>
      asQuery(queryResult([], (value) => captured.push(value))),
    );
    const repo = new MessageTurnContextsRepository(db);
    const acceptedAt = new Date('2026-08-01T00:00:00.000Z');

    await repo.create({
      chatId,
      originRunId: 'run-1',
      messageId: 'message-1',
      ownerUserId,
      modelId: 'model-1',
      effort: 'high',
      acceptedAt,
      snapshotId: 'snapshot-1',
      contextRevision: 3,
      sourceMaxSeq: 9,
      activeCompactionId: 'comp-1',
      digestBaseline: null,
      digestTold: [{ chatId: 'other', pinned: false }],
      digestRebakedFrom: 'comp-9',
    });

    expect(captured).toEqual([
      {
        chatId,
        originRunId: 'run-1',
        messageId: 'message-1',
        ownerUserId,
        modelId: 'model-1',
        effort: 'high',
        acceptedAt,
        snapshotId: 'snapshot-1',
        contextRevision: 3,
        sourceMaxSeq: 9,
        activeCompactionId: 'comp-1',
        digestBaseline: null,
        digestTold: [{ chatId: 'other', pinned: false }],
        digestRebakedFrom: 'comp-9',
      },
    ]);
  });

  it('sets contextItems through a fenced update', async () => {
    const captured: Array<EvidenceUpdate> = [];
    const predicates: Array<SQL> = [];
    const db: Db = drizzle.mock({ schema });
    vi.spyOn(db, 'update').mockImplementation(() =>
      asQuery(
        queryResult(
          [],
          (value) => captured.push(value),
          (predicate) => predicates.push(predicate),
        ),
      ),
    );
    const repo = new MessageTurnContextsRepository(db);
    const items = [
      { producer: 'temporal', residency: 'prefix' as const, text: 'when' },
    ];

    await repo.recordContextItems(chatId, 'run-1', ownerUserId, items);

    expect(captured).toEqual([{ contextItems: items }]);
    // The update is row-scoped: deleting the `.where(...)` clause must
    // fail this, or a redelivered worker could rewrite every row.
    expect(predicates).toHaveLength(1);
    expect(predicates[0]).toBeDefined();
  });
});
