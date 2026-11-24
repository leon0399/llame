/**
 * Pure owner-fork projection tests. The live database integration suite pins
 * the transaction and RLS behavior; these cases pin boundary selection,
 * identity remapping, and inherited Chat state without a database.
 */

import { type Chat } from '../db/schema';
import {
  copiedMessageRows,
  inheritForkedChatState,
  selectForkMessages,
  type CopyableMessage,
} from './fork-copy';
import { isContextItemPart } from './context-item';
import {
  createRecencyDigestItem,
  readDigestPayload,
} from './recency-digest-item';

const NOW = new Date('2026-09-14T00:00:00.000Z');
const CHAT_ID = 'ca7e63ce-66a2-41aa-8a03-4fd8f76d76ab';
const FORK_CHAT_ID = 'a444443f-56d9-4c4c-ae15-47f5a7214c29';
const USER_ID = 'user-id';

const chat = (overrides: Partial<Chat> = {}): Chat => ({
  id: CHAT_ID,
  ownerUserId: USER_ID,
  title: 'Fork me',
  visibility: 'private',
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  modelSelection: null,
  projectId: null,
  skillCatalogBaseline: null,
  skillCatalogRebakedFrom: null,
  skillCatalogTold: null,
  workspaceRoot: null,
  workspaceExecutorId: null,
  workspaceGeneration: 0,
  artifactSeq: 0,
  workspaceTold: null,
  workspaceToldFrom: null,
  workspaceToldAvailable: null,
  workspaceDetachReason: null,
  ...overrides,
});

const row = (
  id: string,
  seq: number,
  overrides: Partial<CopyableMessage> = {},
): CopyableMessage & { seq: number } => ({
  id,
  seq,
  role: 'user',
  parts: [{ type: 'text', text: id }],
  senderUserId: USER_ID,
  attachments: [],
  inReplyTo: null,
  absorbedThroughSeq: null,
  ...overrides,
});

const checkpoint = (
  id: string,
  seq: number,
  absorbedThroughSeq: number,
): CopyableMessage & { seq: number } =>
  row(id, seq, {
    role: 'checkpoint',
    senderUserId: null,
    parts: [{ type: 'data-context', data: { text: `${id} text` } }],
    absorbedThroughSeq,
  });

describe('selectForkMessages', () => {
  it('selects ordinary rows by anchor but checkpoints by absorbed boundary', () => {
    const rows = [
      row('user-1', 1),
      row('assistant-1', 2, { role: 'assistant', senderUserId: null }),
      row('user-2', 3),
      checkpoint('checkpoint-1', 4, 2),
      checkpoint('checkpoint-2', 5, 4),
      row('tool-1', 6, { role: 'tool', senderUserId: null }),
    ];

    expect(selectForkMessages(rows, 3).map(({ id }) => id)).toEqual([
      'user-1',
      'assistant-1',
      'user-2',
      'checkpoint-1',
    ]);
  });

  it('selects every valid row for a whole-chat fork and keeps source order', () => {
    const rows = [row('user-1', 7), checkpoint('checkpoint-1', 8, 7)];

    expect(selectForkMessages(rows, undefined)).toEqual(rows);
  });

  it('selects associated baselines above an anchor and gates imported cutoff notices', () => {
    const checkpointId = 'c941f34a-815d-4c0c-9ad8-6483cd50c29a';
    const checkpointRow = checkpoint(checkpointId, 4, 2);

    const companion = row('checkpoint-companion', 12, {
      senderUserId: null,
      parts: [
        createRecencyDigestItem({
          runId: '123e4567-e89b-12d3-a456-426614174000',
          payload: {
            version: 1,
            kind: 'baseline',
            announced: [],
            association: { kind: 'checkpoint', checkpointId },
          },
          body: 'checkpoint baseline',
        }),
      ],
    });

    const originBaseline = row('origin-baseline', 13, {
      senderUserId: null,
      parts: [
        createRecencyDigestItem({
          runId: '123e4567-e89b-12d3-a456-426614174000',
          payload: {
            version: 1,
            kind: 'baseline',
            announced: [],
            association: { kind: 'origin', chatId: CHAT_ID },
          },
          body: 'origin baseline',
        }),
      ],
    });

    const comparison = row('comparison', 14, {
      senderUserId: null,
      parts: [
        createRecencyDigestItem({
          runId: '123e4567-e89b-12d3-a456-426614174000',
          payload: {
            version: 1,
            kind: 'notice',
            announced: [],
            importedCutoff: { latestTurnSeq: 5, lastOriginalSeq: 6 },
          },
          body: 'conversion notice',
        }),
      ],
    });

    const rows = [
      row('first', 1),
      row('through-cutoff', 2),
      row('anchor', 3),
      checkpointRow,
      companion,
      originBaseline,
      comparison,
    ];

    expect(selectForkMessages(rows, 3, CHAT_ID).map(({ id }) => id)).toEqual([
      'first',
      'through-cutoff',
      'anchor',
      checkpointId,
      'checkpoint-companion',
      'origin-baseline',
    ]);
    expect(selectForkMessages(rows, 6, CHAT_ID).map(({ id }) => id)).toContain(
      'comparison',
    );
  });
});

describe('fork digest history selection', () => {
  it('copies an anchored fork companion only with its checkpoint and remaps its binding', () => {
    const checkpointId = 'c941f34a-815d-4c0c-9ad8-6483cd50c29a';
    const checkpointRow = checkpoint(checkpointId, 4, 2);

    const companion = row('checkpoint-companion', 12, {
      senderUserId: null,
      parts: [
        createRecencyDigestItem({
          runId: '123e4567-e89b-12d3-a456-426614174000',
          payload: {
            version: 1,
            kind: 'baseline',
            announced: [],
            association: { kind: 'checkpoint', checkpointId },
          },
          body: 'checkpoint baseline',
        }),
      ],
    });

    const matchingOrigin = row('matching-origin-baseline', 13, {
      senderUserId: null,
      parts: [
        createRecencyDigestItem({
          runId: '123e4567-e89b-12d3-a456-426614174000',
          payload: {
            version: 1,
            kind: 'baseline',
            announced: [],
            association: { kind: 'origin', chatId: CHAT_ID },
          },
          body: 'origin baseline',
        }),
      ],
    });

    const foreignOrigin = row('foreign-origin-baseline', 14, {
      senderUserId: null,
      parts: [
        createRecencyDigestItem({
          runId: '123e4567-e89b-12d3-a456-426614174000',
          payload: {
            version: 1,
            kind: 'baseline',
            announced: [],
            association: {
              kind: 'origin',
              chatId: 'db3f4d78-b8d3-469a-a083-b17f1d8e08e5',
            },
          },
          body: 'another chat baseline',
        }),
      ],
    });

    const rows = [
      row('first', 1),
      row('absorbed-turn', 2),
      row('anchor', 3),
      checkpointRow,
      companion,
      matchingOrigin,
      foreignOrigin,
    ];

    const selected = selectForkMessages(rows, 3, CHAT_ID);
    expect(selectForkMessages(rows, 1, CHAT_ID).map(({ id }) => id)).toEqual([
      'first',
      matchingOrigin.id,
    ]);

    expect(selected.map(({ id }) => id)).toEqual([
      'first',
      'absorbed-turn',
      'anchor',
      checkpointId,
      companion.id,
      matchingOrigin.id,
    ]);

    const copiedCheckpointId = 'b1d0994d-3be8-49f3-b6b0-751a9bc01eb0';

    const copied = copiedMessageRows(
      selected,
      FORK_CHAT_ID,
      new Map(
        selected.map((message) => [
          message.id,
          message.id === checkpointId
            ? copiedCheckpointId
            : `copied-${message.id}`,
        ]),
      ),
    );

    const copiedCompanion = copied.find(
      (message) => message.id === `copied-${companion.id}`,
    );

    const copiedPart = copiedCompanion?.parts[0];

    if (!isContextItemPart(copiedPart)) {
      throw new Error('Copied checkpoint companion part is invalid');
    }

    expect(readDigestPayload(copiedPart)?.association).toEqual({
      kind: 'checkpoint',
      checkpointId: copiedCheckpointId,
    });
    expect(copiedCompanion?.seq).toBe(5);
  });

  it('keeps an imported cutoff notice in an anchored fork when both cutoff turns are included', () => {
    const notice = row('comparison', 20, {
      senderUserId: null,
      parts: [
        createRecencyDigestItem({
          runId: '123e4567-e89b-12d3-a456-426614174000',
          payload: {
            version: 1,
            kind: 'notice',
            announced: [],
            importedCutoff: { latestTurnSeq: 3, lastOriginalSeq: 5 },
          },
          body: 'historical comparison',
        }),
      ],
    });

    const rows = [
      row('original-1', 1),
      row('latest-trigger', 3),
      row('original-last', 5),
      notice,
      row('after-cutoff', 6),
    ];

    expect(selectForkMessages(rows, 5, CHAT_ID).map(({ id }) => id)).toEqual([
      'original-1',
      'latest-trigger',
      'original-last',
      notice.id,
    ]);
    expect(selectForkMessages(rows, 3, CHAT_ID).map(({ id }) => id)).toEqual([
      'original-1',
      'latest-trigger',
    ]);
  });

  it('includes the imported cutoff notice when an anchored fork ends exactly at its latest turn', () => {
    const notice = row('comparison', 20, {
      senderUserId: null,
      parts: [
        createRecencyDigestItem({
          runId: '123e4567-e89b-12d3-a456-426614174000',
          payload: {
            version: 1,
            kind: 'notice',
            announced: [],
            importedCutoff: { latestTurnSeq: 3, lastOriginalSeq: 3 },
          },
          body: 'historical comparison',
        }),
      ],
    });

    const rows = [row('original', 2), row('latest-trigger', 3), notice];

    expect(selectForkMessages(rows, 3, CHAT_ID).map(({ id }) => id)).toEqual([
      'original',
      'latest-trigger',
      notice.id,
    ]);
  });
});

describe('inheritForkedChatState', () => {
  const first = checkpoint('checkpoint-1', 3, 2);
  const latest = checkpoint('checkpoint-2', 6, 5);
  const prefix = [first, latest];

  it('remaps the skill marker to the copied checkpoint id', () => {
    const source = chat({ skillCatalogRebakedFrom: latest.id });
    const { messageIds, inherited } = inheritForkedChatState(source, prefix);

    expect(inherited.skillCatalogRebakedFrom).toBe(messageIds.get(latest.id));
    expect(inherited.skillCatalogRebakedFrom).not.toBe(latest.id);
  });

  it('maps an uncopied marker to the copied active checkpoint or null', () => {
    const source = chat({
      skillCatalogRebakedFrom: latest.id,
    });

    const onlyFirst = inheritForkedChatState(source, [first]);
    const firstCopyId = onlyFirst.messageIds.get(first.id);

    expect(onlyFirst.inherited.skillCatalogRebakedFrom).toBe(firstCopyId);

    const noCheckpoints = inheritForkedChatState(source, []);
    expect(noCheckpoints.inherited.skillCatalogRebakedFrom).toBeNull();
  });

  it('falls back to the newest copied checkpoint when several are copied', () => {
    const source = chat({
      skillCatalogRebakedFrom: 'checkpoint-outside-prefix',
    });

    const { messageIds, inherited } = inheritForkedChatState(source, prefix);

    expect(inherited.skillCatalogRebakedFrom).toBe(messageIds.get(latest.id));
  });

  it('keeps null markers null and carries frozen state and the active binding', () => {
    const source = chat({
      skillCatalogBaseline: {
        entries: [{ name: 'alpha', description: 'A' }],
        omitted: 0,
      },
      skillCatalogTold: ['alpha'],
      workspaceRoot: '/work/project',
      workspaceExecutorId: 'worker-a',
      workspaceGeneration: 7,
      artifactSeq: 5,
    });

    const { inherited } = inheritForkedChatState(source, prefix);

    expect(inherited).toMatchObject({
      createdAt: source.createdAt,
      skillCatalogBaseline: source.skillCatalogBaseline,
      skillCatalogTold: source.skillCatalogTold,
      workspaceRoot: '/work/project',
      workspaceExecutorId: 'worker-a',
      workspaceGeneration: 7,
      artifactSeq: 5,
      skillCatalogRebakedFrom: null,
    });
    expect(inherited).not.toHaveProperty('workspaceTold');
    expect(inherited).not.toHaveProperty('workspaceToldFrom');
    expect(inherited).not.toHaveProperty('workspaceDetachReason');
  });
});

describe('copiedMessageRows', () => {
  it('writes dense sequences and remaps a checkpoint boundary to the copied row', () => {
    const first = row('message-1', 10);

    const second = row('message-2', 20, {
      role: 'assistant',
      senderUserId: null,
      inReplyTo: first.id,
    });

    const checkpointRow = checkpoint('checkpoint-1', 30, second.seq);
    const rows = [first, second, checkpointRow];

    const { messageIds } = inheritForkedChatState(chat(), rows);
    const copied = copiedMessageRows(rows, FORK_CHAT_ID, messageIds);

    expect(copied.map((item) => item.seq)).toEqual([1, 2, 3]);
    expect(copied.map((item) => item.chatId)).toEqual([
      FORK_CHAT_ID,
      FORK_CHAT_ID,
      FORK_CHAT_ID,
    ]);
    const copiedIds = copied.map((item) => item.id);
    expect(new Set(copiedIds).size).toBe(rows.length);
    expect(
      copiedIds.filter((id) => rows.some((item) => item.id === id)),
    ).toEqual([]);
    expect(copied[1].inReplyTo).toBe(copied[0].id);
    expect(copied[2].absorbedThroughSeq).toBe(2);
    expect(copied[2].parts).toEqual(checkpointRow.parts);
  });

  it.each(['baseline', 'notice'] as const)(
    'remaps a %s epoch association in its stored carrier without rewriting text',
    (kind) => {
      const checkpointId = 'c941f34a-815d-4c0c-9ad8-6483cd50c29a';
      const checkpointRow = checkpoint(checkpointId, 2, 1);

      const companion = row('companion', 8, {
        senderUserId: kind === 'baseline' ? null : 'owner',
        parts: [
          ...(kind === 'notice' ? [{ type: 'text', text: 'Owner turn' }] : []),
          createRecencyDigestItem({
            runId: '123e4567-e89b-12d3-a456-426614174000',
            payload: {
              version: 1,
              kind,
              announced: [],
              association: { kind: 'checkpoint', checkpointId },
            },
            body: 'unchanged snapshot text',
          }),
        ],
      });

      const rows = [row('turn', 1), checkpointRow, companion];

      const ids = new Map([
        [checkpointId, 'b1d0994d-3be8-49f3-b6b0-751a9bc01eb0'],
        ['turn', 'c77f65f4-d2e5-475d-8429-29f708ff5d2c'],
        ['companion', 'd31f3fa1-b0f0-4871-98b8-bb6553bb7948'],
      ]);

      const copied = copiedMessageRows(rows, FORK_CHAT_ID, ids);
      const partIndex = kind === 'baseline' ? 0 : 1;
      const copiedPart = copied[2]?.parts[partIndex];
      const sourcePart = companion.parts[partIndex];

      if (!isContextItemPart(copiedPart) || !isContextItemPart(sourcePart)) {
        throw new Error('Digest companion part is invalid');
      }

      expect(readDigestPayload(copiedPart)?.association).toEqual({
        kind: 'checkpoint',
        checkpointId: ids.get(checkpointId),
      });
      expect(copiedPart.data.text).toBe(sourcePart.data.text);
    },
  );

  it('remaps imported checkpoint association and comparison cutoffs together', () => {
    const checkpointId = 'c941f34a-815d-4c0c-9ad8-6483cd50c29a';
    const checkpointRow = checkpoint(checkpointId, 5, 4);

    const notice = row('comparison', 30, {
      senderUserId: null,
      parts: [
        createRecencyDigestItem({
          runId: '123e4567-e89b-12d3-a456-426614174000',
          payload: {
            version: 1,
            kind: 'notice',
            announced: [],
            association: { kind: 'checkpoint', checkpointId },
            importedCutoff: { latestTurnSeq: 10, lastOriginalSeq: 25 },
          },
          body: 'unchanged comparison text',
        }),
      ],
    });

    const rows = [
      row('absorbed-user', 4),
      checkpointRow,
      row('latest-user', 10),
      row('latest-assistant', 20, { role: 'assistant', senderUserId: null }),
      notice,
    ];

    const ids = new Map([
      ['absorbed-user', 'f75996d1-7603-4b21-86b6-96917fe20ea8'],
      [checkpointId, 'b1d0994d-3be8-49f3-b6b0-751a9bc01eb0'],
      ['latest-user', 'c77f65f4-d2e5-475d-8429-29f708ff5d2c'],
      ['latest-assistant', 'd31f3fa1-b0f0-4871-98b8-bb6553bb7948'],
      ['comparison', 'b4d9d1c8-85de-41ec-a76e-50f54ff934a2'],
    ]);

    const copied = copiedMessageRows(rows, FORK_CHAT_ID, ids);
    const copiedPart = copied[4]?.parts[0];
    const sourcePart = notice.parts[0];

    if (!isContextItemPart(copiedPart) || !isContextItemPart(sourcePart)) {
      throw new Error('Imported comparison part is invalid');
    }

    expect(readDigestPayload(copiedPart)).toMatchObject({
      association: {
        kind: 'checkpoint',
        checkpointId: ids.get(checkpointId),
      },
      importedCutoff: { latestTurnSeq: 3, lastOriginalSeq: 4 },
    });
    expect(copiedPart.data.text).toBe(sourcePart.data.text);
  });

  it('copies owner content, createdAt, usage, and attachments verbatim', () => {
    const createdAt = new Date('2026-09-13T10:00:00.000Z');
    const usage = { status: 'completed', totalTokens: 42 };

    const rows = [
      row('message-1', 1, {
        parts: [{ type: 'text', text: 'question' }],
        attachments: [{ type: 'file', name: 'notes.txt' }],
        createdAt,
        usage: null,
      }),
      row('message-2', 2, {
        role: 'assistant',
        senderUserId: null,
        inReplyTo: 'message-1',
        createdAt,
        usage,
      }),
    ];

    const copied = copiedMessageRows(rows, FORK_CHAT_ID);

    expect(copied[0]).toMatchObject({
      role: 'user',
      parts: rows[0].parts,
      attachments: rows[0].attachments,
      createdAt,
      usage: null,
      absorbedThroughSeq: null,
    });
    expect(copied[1]).toMatchObject({
      role: 'assistant',
      parts: rows[1].parts,
      createdAt,
      usage,
      absorbedThroughSeq: null,
    });
  });

  it('fails closed when a copied checkpoint does not name a copied row', () => {
    const rows = [checkpoint('checkpoint-1', 10, 7)];

    expect(() => copiedMessageRows(rows, FORK_CHAT_ID)).toThrow(
      'names a row outside the copied prefix',
    );
  });
});
