/**
 * The pure projection an owner fork applies to its source: which Chat-row
 * state travels with it and what the copied message rows look like.
 * `ChatsService` owns the transaction and writes; everything decided here is
 * decided without a database.
 */

import { type Chat, type MessageRole } from '../db/schema';
import { type ChatInheritedValues } from './chats-repository';

/**
 * A source row either fork path copies. `createdAt`/`usage` are the owner
 * fork's verbatim copy of a turn's time and price; the shared fork omits both,
 * so its rows stay exactly what the public projection describes.
 */
export type CopyableMessage = {
  id: string;
  role: MessageRole;
  parts: Array<unknown>;
  attachments: Array<unknown>;
  senderUserId: string | null;
  inReplyTo: string | null;
  seq?: number;
  absorbedThroughSeq?: number | null;
  createdAt?: Date;
  usage?: unknown;
};

/**
 * A row's sequence is needed only for owner-fork boundary selection/remapping.
 */
type SequencedCopyableMessage = CopyableMessage & { seq: number };

/**
 * Owner forks copy ordinary conversation rows through the anchor and copy a
 * checkpoint when the conversation rows it absorbed end at or before it. A
 * checkpoint is stored after its absorbed rows, so filtering on its own seq
 * would incorrectly omit a checkpoint when the anchor is inside the live tail.
 */
export function selectForkMessages(
  messages: ReadonlyArray<SequencedCopyableMessage>,
  maxSeq: number | undefined,
): Array<SequencedCopyableMessage> {
  return messages.filter((message) => {
    if (message.role === 'checkpoint') {
      return (
        message.absorbedThroughSeq !== undefined &&
        message.absorbedThroughSeq !== null &&
        (maxSeq === undefined || message.absorbedThroughSeq <= maxSeq)
      );
    }

    return (
      (message.role === 'user' || message.role === 'assistant') &&
      (maxSeq === undefined || message.seq <= maxSeq)
    );
  });
}

/**
 * Repoint one of a Chat row's re-bake markers at the fork's copies of the
 * checkpoint messages. `activeCheckpointId` is the newest copied checkpoint.
 * A marker naming an uncopied checkpoint falls back to that active copy, or to
 * null when the copied prefix contains no checkpoint.
 */
function remapRebakeMarker(
  marker: string | null,
  copiedCheckpointIds: ReadonlyMap<string, string>,
  activeCheckpointId: string | null,
): string | null {
  if (marker === null) return null;
  return copiedCheckpointIds.get(marker) ?? activeCheckpointId;
}

/**
 * Preallocate copied message identities and derive the Chat-row values that
 * reference them. The destination Chat must already name copied checkpoints
 * before it is inserted.
 */
type CopiedCheckpointState = {
  copiedCheckpointIds: ReadonlyMap<string, string>;
  activeCheckpointId: string | null;
};

function copiedCheckpointState(
  toCopy: ReadonlyArray<SequencedCopyableMessage>,
  messageIds: ReadonlyMap<string, string>,
): CopiedCheckpointState {
  const copiedCheckpoints = toCopy.filter(
    (message) => message.role === 'checkpoint',
  );
  const copiedCheckpointIds = new Map<string, string>(
    copiedCheckpoints.map((message) => [
      message.id,
      messageIds.get(message.id)!,
    ]),
  );
  const active = copiedCheckpoints.at(-1);
  return {
    copiedCheckpointIds,
    activeCheckpointId:
      active === undefined ? null : (messageIds.get(active.id) ?? null),
  };
}

export function inheritForkedChatState(
  source: Chat,
  toCopy: ReadonlyArray<SequencedCopyableMessage>,
) {
  const messageIds = new Map<string, string>(
    toCopy.map((message) => [message.id, crypto.randomUUID()]),
  );
  const { copiedCheckpointIds, activeCheckpointId } = copiedCheckpointState(
    toCopy,
    messageIds,
  );

  return {
    messageIds,
    inherited: {
      createdAt: source.createdAt,
      recencyDigestBaseline: source.recencyDigestBaseline,
      recencyDigestTold: source.recencyDigestTold,
      recencyDigestRebakedFrom: remapRebakeMarker(
        source.recencyDigestRebakedFrom,
        copiedCheckpointIds,
        activeCheckpointId,
      ),
      skillCatalogBaseline: source.skillCatalogBaseline,
      skillCatalogTold: source.skillCatalogTold,
      skillCatalogRebakedFrom: remapRebakeMarker(
        source.skillCatalogRebakedFrom,
        copiedCheckpointIds,
        activeCheckpointId,
      ),
      workspaceRoot: source.workspaceRoot,
      workspaceExecutorId: source.workspaceExecutorId,
      workspaceGeneration: source.workspaceGeneration,
    } satisfies ChatInheritedValues,
  };
}

type CopiedMessageRow = {
  id: string;
  chatId: string;
  seq: number;
  role: MessageRole;
  senderUserId: string | null;
  parts: Array<unknown>;
  attachments: Array<unknown>;
  absorbedThroughSeq: number | null;
  inReplyTo: string | null;
  createdAt?: Date;
  usage?: unknown;
};

function checkpointBoundaryForCopy(
  message: CopyableMessage,
  newSeqBySourceSeq: ReadonlyMap<number, number>,
): number | null {
  if (message.role !== 'checkpoint') return null;
  if (
    message.absorbedThroughSeq === undefined ||
    message.absorbedThroughSeq === null
  ) {
    throw new Error(`Checkpoint ${message.id} is missing absorbedThroughSeq`);
  }
  const copiedBoundary = newSeqBySourceSeq.get(message.absorbedThroughSeq);
  if (copiedBoundary === undefined) {
    throw new Error(
      `Checkpoint ${message.id} names a row outside the copied prefix`,
    );
  }
  return copiedBoundary;
}

function copiedMessageRow(input: {
  message: CopyableMessage;
  index: number;
  chatId: string;
  messageIds: ReadonlyMap<string, string>;
  newSeqBySourceSeq: ReadonlyMap<number, number>;
}): CopiedMessageRow {
  const { message, index, chatId, messageIds, newSeqBySourceSeq } = input;
  return {
    id: messageIds.get(message.id)!,
    chatId,
    seq: index + 1,
    role: message.role,
    senderUserId: message.senderUserId,
    parts: message.parts,
    attachments: message.attachments,
    absorbedThroughSeq: checkpointBoundaryForCopy(message, newSeqBySourceSeq),
    inReplyTo: message.inReplyTo
      ? (messageIds.get(message.inReplyTo) ?? null)
      : null,
    // Both forks pass all-or-nothing: an absent value reaches the INSERT as
    // `undefined` and takes the column default (`now()` for `createdAt`,
    // NULL for `usage`) rather than an explicit null.
    createdAt: message.createdAt,
    usage: message.usage,
  };
}

/**
 * The copied message rows, in source order with dense sequences from 1. Ids
 * are pre-assigned before any insert so `inReplyTo` and checkpoint boundaries
 * can be remapped without a per-row RETURNING round-trip.
 */
export function copiedMessageRows(
  toCopy: ReadonlyArray<CopyableMessage>,
  chatId: string,
  messageIds: ReadonlyMap<string, string> = new Map(
    toCopy.map((message) => [message.id, crypto.randomUUID()]),
  ),
): Array<CopiedMessageRow> {
  const newSeqBySourceSeq = new Map(
    toCopy.map((message, index) => [message.seq ?? index + 1, index + 1]),
  );
  return toCopy.map((message, index) =>
    copiedMessageRow({
      message,
      index,
      chatId,
      messageIds,
      newSeqBySourceSeq,
    }),
  );
}
