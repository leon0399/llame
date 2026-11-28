/**
 * The pure projection an owner fork applies to its source: which Chat-row
 * state travels with it and what the copied message rows look like.
 * `ChatsService` owns the transaction and writes; everything decided here is
 * decided without a database.
 */

import { type Chat, type MessageRole } from '../db/schema';
import { type ChatInheritedValues } from './chats-repository';
import { digestCarrierPayload } from './recency-digest-replay';
import {
  readDigestPayload,
  type DigestAssociation,
} from './recency-digest-item';
import { isContextItemPart, type ContextItemPart } from './context-item';

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

type ImportedCutoff = {
  latestTurnSeq: number;
  lastOriginalSeq: number;
};

/**
 * Owner forks copy ordinary conversation rows through the anchor and copy a
 * checkpoint when the conversation rows it absorbed end at or before it. A
 * checkpoint is stored after its absorbed rows, so filtering on its own seq
 * would incorrectly omit a checkpoint when the anchor is inside the live tail.
 */
export function selectForkMessages(
  messages: ReadonlyArray<SequencedCopyableMessage>,
  maxSeq: number | undefined,
  sourceChatId?: string,
): Array<SequencedCopyableMessage> {
  const selectedCheckpoints = selectedForkCheckpoints(messages, maxSeq);

  return messages.filter((message) =>
    shouldCopyForkMessage(message, maxSeq, sourceChatId, selectedCheckpoints),
  );
}

function selectedForkCheckpoints(
  messages: ReadonlyArray<SequencedCopyableMessage>,
  maxSeq: number | undefined,
): Set<string> {
  const selected = new Set<string>();

  for (const message of messages) {
    if (
      message.role === 'checkpoint' &&
      message.absorbedThroughSeq !== undefined &&
      message.absorbedThroughSeq !== null &&
      (maxSeq === undefined || message.absorbedThroughSeq <= maxSeq)
    ) {
      selected.add(message.id);
    }
  }

  return selected;
}

function shouldCopyForkMessage(
  message: SequencedCopyableMessage,
  maxSeq: number | undefined,
  sourceChatId: string | undefined,
  selectedCheckpoints: ReadonlySet<string>,
): boolean {
  if (message.role === 'checkpoint') return selectedCheckpoints.has(message.id);

  if (message.role !== 'user' && message.role !== 'assistant') return false;

  const payload = digestCarrierPayload(message);

  if (payload === undefined) {
    return maxSeq === undefined || message.seq <= maxSeq;
  }

  if (payload.kind === 'baseline') {
    return (
      (payload.association?.kind === 'origin' &&
        (sourceChatId === undefined ||
          payload.association.chatId === sourceChatId)) ||
      (payload.association?.kind === 'checkpoint' &&
        selectedCheckpoints.has(payload.association.checkpointId))
    );
  }

  return (
    payload.importedCutoff !== undefined &&
    (maxSeq === undefined ||
      (maxSeq >= payload.importedCutoff.latestTurnSeq &&
        maxSeq >= payload.importedCutoff.lastOriginalSeq))
  );
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
export function inheritForkedChatState(
  source: Chat,
  toCopy: ReadonlyArray<SequencedCopyableMessage>,
) {
  const messageIds = new Map<string, string>(
    toCopy.map((message) => [message.id, crypto.randomUUID()]),
  );

  const copiedCheckpointIds = new Map<string, string>();

  for (const message of toCopy) {
    if (message.role === 'checkpoint') {
      copiedCheckpointIds.set(message.id, messageIds.get(message.id)!);
    }
  }

  const activeCheckpointId = [...copiedCheckpointIds.values()].at(-1) ?? null;

  return {
    messageIds,
    inherited: {
      createdAt: source.createdAt,
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
      // The fork copies the cited artifacts, so its counter continues where
      // the source's stopped.
      artifactSeq: source.artifactSeq,
      // The owner's selection and any fallback hold travel unchanged, so a
      // fork of a held Chat keeps serving its held model until the same
      // `revertAt` (model-roles: "An owner fork copies the selection and the
      // hold").
      modelSelection: source.modelSelection,
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

function remapDigestParts(
  message: CopyableMessage,
  chatId: string,
  messageIds: ReadonlyMap<string, string>,
  newSeqBySourceSeq: ReadonlyMap<number, number>,
): Array<unknown> {
  if (!message.parts.some(isContextItemPart)) return message.parts;

  return message.parts.map((part) =>
    isContextItemPart(part)
      ? remapDigestPart(part, chatId, messageIds, newSeqBySourceSeq)
      : part,
  );
}

function remapDigestPart(
  part: ContextItemPart,
  chatId: string,
  messageIds: ReadonlyMap<string, string>,
  newSeqBySourceSeq: ReadonlyMap<number, number>,
): ContextItemPart {
  const payload = readDigestPayload(part);

  if (payload === undefined) return part;

  if (
    payload.association === undefined &&
    payload.importedCutoff === undefined
  ) {
    return part;
  }

  const remappedPayload = { ...payload };

  if (payload.association !== undefined) {
    remappedPayload.association =
      payload.association.kind === 'origin'
        ? { kind: 'origin', chatId }
        : remappedCheckpointAssociation(payload.association, messageIds);
  }

  if (payload.importedCutoff !== undefined) {
    remappedPayload.importedCutoff = remapImportedCutoff(
      payload.importedCutoff,
      newSeqBySourceSeq,
    );
  }

  return {
    ...part,
    data: { ...part.data, payload: remappedPayload },
  };
}

function remapImportedCutoff(
  cutoff: ImportedCutoff,
  newSeqBySourceSeq: ReadonlyMap<number, number>,
): ImportedCutoff {
  const latestTurnSeq = newSeqBySourceSeq.get(cutoff.latestTurnSeq);

  if (latestTurnSeq === undefined) {
    throw new Error('Imported digest latest turn was not copied');
  }

  let lastOriginalSeq = 0;
  let greatestSourceSeq = -1;

  for (const [sourceSeq, copiedSeq] of newSeqBySourceSeq) {
    if (sourceSeq <= cutoff.lastOriginalSeq && sourceSeq > greatestSourceSeq) {
      greatestSourceSeq = sourceSeq;
      lastOriginalSeq = copiedSeq;
    }
  }

  return { latestTurnSeq, lastOriginalSeq };
}

function remappedCheckpointAssociation(
  association: Extract<DigestAssociation, { kind: 'checkpoint' }>,
  messageIds: ReadonlyMap<string, string>,
): DigestAssociation {
  const checkpointId = messageIds.get(association.checkpointId);

  if (checkpointId === undefined) {
    throw new Error('Digest companion checkpoint was not copied');
  }

  return { kind: 'checkpoint', checkpointId };
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

  return toCopy.map((message, index) => ({
    id: messageIds.get(message.id)!,
    chatId,
    seq: index + 1,
    role: message.role,
    senderUserId: message.senderUserId,
    parts: remapDigestParts(message, chatId, messageIds, newSeqBySourceSeq),
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
  }));
}
