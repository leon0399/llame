import { describe, expect, it } from 'vitest';
import type { Message } from '../db/schema';
import { toStoredMessages } from '../compaction/compaction';
import {
  createRecencyDigestItem,
  deriveRecencyDigestState,
  type DigestAssociation,
} from './recency-digest-item';
import {
  selectContextHistory,
  selectEffectiveDigestMessages,
  projectDigestEpochParts,
} from './recency-digest-replay';

const chatId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sourceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function message(seq: number, fields: Partial<Message> = {}): Message {
  return {
    id: `message-${seq}`,
    chatId,
    seq,
    role: 'user',
    absorbedThroughSeq: null,
    senderUserId: 'owner',
    parts: [{ type: 'text', text: `turn ${seq}` }],
    attachments: [],
    usage: null,
    inReplyTo: null,
    createdAt: new Date(seq * 1000),
    revisedAt: null,
    ...fields,
  };
}

function importedNotice(association?: DigestAssociation): Message {
  return message(101, {
    senderUserId: null,
    parts: [
      createRecencyDigestItem({
        runId,
        body: 'Historical comparison state.',
        payload: {
          version: 1,
          kind: 'notice',
          announced: [],
          association: association ?? { kind: 'origin', chatId },
          importedCutoff: { latestTurnSeq: 99, lastOriginalSeq: 100 },
        },
      }),
    ],
  });
}

describe('imported digest replay boundaries', () => {
  it('places the historical notice before the latest original trigger on its retry', () => {
    const trigger = message(99);

    const history = selectEffectiveDigestMessages(
      [trigger, importedNotice()],
      chatId,
      { throughSeq: 99 },
    );

    const selected = selectContextHistory(
      toStoredMessages([...history, trigger]),
      undefined,
    );

    expect(selected.ordered.map((row) => row.id)).toEqual([
      'message-101',
      'message-99',
    ]);
  });

  it('keeps later disclosure authoritative over the imported comparison', () => {
    const later = message(102, {
      parts: [
        createRecencyDigestItem({
          runId,
          body: 'A newly disclosed Chat.',
          payload: {
            version: 1,
            kind: 'notice',
            announced: [{ chatId: sourceId, title: 'New Chat', pinned: false }],
          },
        }),
      ],
    });

    const history = selectEffectiveDigestMessages(
      [later, importedNotice()],
      chatId,
      { throughSeq: 104 },
    );

    expect(history.map((row) => row.seq)).toEqual([101, 102]);
    expect(
      deriveRecencyDigestState(history.flatMap((row) => row.parts)).announced,
    ).toEqual([{ chatId: sourceId, title: 'New Chat', pinned: false }]);
  });
  it('keeps an import comparison in its conversion epoch and gives a fresh checkpoint the retry', () => {
    const originalCheckpointId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const freshCheckpointId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

    const originalCheckpoint = message(98, {
      id: originalCheckpointId,
      role: 'checkpoint',
      senderUserId: null,
      absorbedThroughSeq: 98,
    });

    const freshCheckpoint = message(102, {
      id: freshCheckpointId,
      role: 'checkpoint',
      senderUserId: null,
      absorbedThroughSeq: 98,
    });

    const notice = importedNotice({
      kind: 'checkpoint',
      checkpointId: originalCheckpointId,
    });

    const freshCompanion = message(103, {
      senderUserId: null,
      parts: [
        createRecencyDigestItem({
          runId,
          body: 'Fresh checkpoint comparison.',
          payload: {
            version: 1,
            kind: 'baseline',
            announced: [],
            association: {
              kind: 'checkpoint',
              checkpointId: freshCheckpointId,
            },
          },
        }),
      ],
    });

    const trigger = message(99);

    expect(
      selectEffectiveDigestMessages(
        [notice, originalCheckpoint, trigger],
        chatId,
        { throughSeq: 99, checkpointId: originalCheckpointId },
      ).map((row) => row.id),
    ).toContain(notice.id);

    expect(
      projectDigestEpochParts(notice.parts, {
        kind: 'checkpoint',
        checkpointId: originalCheckpointId,
      }),
    ).toEqual(notice.parts);
    expect(
      projectDigestEpochParts(notice.parts, {
        kind: 'checkpoint',
        checkpointId: freshCheckpointId,
      }),
    ).toEqual([]);

    const retryHistory = selectEffectiveDigestMessages(
      [notice, freshCheckpoint, freshCompanion, trigger],
      chatId,
      { throughSeq: 99, checkpointId: freshCheckpointId },
    );

    expect(retryHistory.map((row) => row.id)).toEqual([freshCompanion.id]);

    const selected = selectContextHistory(
      toStoredMessages([...retryHistory, trigger]),
      {
        id: freshCheckpointId,
        text: 'Fresh checkpoint.',
        absorbedThroughSeq: 98,
      },
    );

    expect(selected.checkpointCompanion?.id).toBe(freshCompanion.id);
    expect(selected.ordered.map((row) => row.id)).toEqual([trigger.id]);
  });

  it('does not carry imported comparison into a later checkpoint epoch', () => {
    const checkpoint = message(105, {
      role: 'checkpoint',
      senderUserId: null,
      absorbedThroughSeq: 104,
    });

    const next = message(106);
    expect(
      selectEffectiveDigestMessages(
        [importedNotice(), checkpoint, next],
        chatId,
        {
          throughSeq: 106,
          checkpointId: checkpoint.id,
        },
      ),
    ).toEqual([]);
    expect(
      selectContextHistory(toStoredMessages([importedNotice(), next]), {
        id: checkpoint.id,
        text: 'A later summary.',
        absorbedThroughSeq: 104,
      }).ordered.map((row) => row.id),
    ).toEqual([next.id]);
  });

  it('excludes a trigger disclosure from an earlier epoch without changing stored bytes', () => {
    const checkpointId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

    const old = createRecencyDigestItem({
      runId,
      body: 'Earlier baseline.',
      payload: {
        version: 1,
        kind: 'baseline',
        announced: [],
        association: { kind: 'origin', chatId },
      },
    });

    const current = createRecencyDigestItem({
      runId,
      body: 'Current correction.',
      payload: {
        version: 1,
        kind: 'notice',
        announced: [{ chatId: sourceId, pinned: true }],
        association: { kind: 'checkpoint', checkpointId },
      },
    });

    const ownerText = { type: 'text', text: 'Owner request' };
    const stored = [old, ownerText, current];
    const bytes = JSON.stringify(stored);

    const projected = projectDigestEpochParts(stored, {
      kind: 'checkpoint',
      checkpointId,
    });

    expect(projected).toEqual([ownerText, current]);
    expect(deriveRecencyDigestState(projected).announced).toEqual([
      { chatId: sourceId, pinned: true },
    ]);
    expect(JSON.stringify(stored)).toBe(bytes);
    expect(
      projectDigestEpochParts([ownerText, current], { kind: 'origin', chatId }),
    ).toEqual([ownerText]);
  });
});
