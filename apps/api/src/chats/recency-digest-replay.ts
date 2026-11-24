import type { Message } from '../db/schema';
import type { ContextCheckpoint, StoredMessage } from './context-builder';
import { isDigestOnlyHostMessage } from './message-eligibility';
import { isContextItemPart } from './context-item';
import {
  readDigestPayload,
  type DigestAssociation,
  type DigestPayload,
} from './recency-digest-item';

/** The fields shared by all persisted-message projections that carry digest data. */
type DigestCarrier = {
  role: string;
  senderUserId?: string | null;
  parts?: ReadonlyArray<unknown>;
};

/** Read current digest metadata only from the strict host-authored carrier shape. */
export function digestCarrierPayload(
  message: DigestCarrier,
): DigestPayload | undefined {
  if (!isDigestOnlyHostMessage(message)) return undefined;

  const [part] = message.parts ?? [];

  return isContextItemPart(part) ? readDigestPayload(part) : undefined;
}

type ReplayMessage = StoredMessage;

type ReplayCheckpoint = ContextCheckpoint;

type ContextHistorySelection = {
  originBaseline?: ReplayMessage;
  checkpointCompanion?: ReplayMessage;
  ordered: Array<ReplayMessage>;
};

type EffectiveReplayOptions = {
  throughSeq: number;
  checkpointId?: string;
};

type EffectiveReplaySelection = {
  chatId: string;
  options: EffectiveReplayOptions;
  checkpoint: EffectiveReplayMessage | undefined;
  boundary: number;
};

/** Select and order the effective history window around a triggering turn. */
export function selectContextHistory(
  messages: ReadonlyArray<ReplayMessage>,
  checkpoint: ReplayCheckpoint | undefined,
): ContextHistorySelection {
  const history = selectHistoryRows(messages, checkpoint);

  const checkpointCompanion = checkpoint
    ? findCheckpointCompanion(history, checkpoint.id)
    : undefined;

  const originBaseline = checkpoint ? undefined : findOriginBaseline(history);

  const throughSeq = history.reduce(
    (latest, message) =>
      digestCarrierPayload(message) === undefined
        ? Math.max(latest, message.seq)
        : latest,
    0,
  );

  const ordered = history
    .filter(
      (message) =>
        message !== checkpointCompanion && message !== originBaseline,
    )
    .sort((left, right) => compareDigestReplayRows(left, right, throughSeq));

  return { originBaseline, checkpointCompanion, ordered };
}

function selectHistoryRows(
  messages: ReadonlyArray<ReplayMessage>,
  checkpoint: ReplayCheckpoint | undefined,
): Array<ReplayMessage> {
  return messages.filter((message) => {
    if (
      message.role === 'system' ||
      message.role === 'tool' ||
      message.role === 'checkpoint'
    ) {
      return false;
    }

    const payload = digestCarrierPayload(message);

    if (
      payload?.kind === 'baseline' &&
      payload.association?.kind === 'origin'
    ) {
      return checkpoint === undefined;
    }

    if (payload?.importedCutoff !== undefined) {
      return (
        importedDigestMatchesEpoch(payload, message.chatId, checkpoint) &&
        (checkpoint === undefined ||
          checkpoint.absorbedThroughSeq <
            payload.importedCutoff.lastOriginalSeq)
      );
    }

    return (
      checkpoint === undefined || message.seq > checkpoint.absorbedThroughSeq
    );
  });
}

function importedDigestMatchesEpoch(
  payload: DigestPayload,
  chatId: string,
  checkpoint: { id: string } | undefined,
): boolean {
  const association = payload.association;

  if (association?.kind === 'checkpoint') {
    return association.checkpointId === checkpoint?.id;
  }

  if (association?.kind === 'origin') {
    return checkpoint === undefined && association.chatId === chatId;
  }

  // Unbound imported comparisons predate epoch metadata. They are safe only
  // while no checkpoint has superseded their original context.
  return checkpoint === undefined;
}

function findCheckpointCompanion(
  history: ReadonlyArray<ReplayMessage>,
  checkpointId: string,
): ReplayMessage | undefined {
  return history.find((message) => {
    const payload = digestCarrierPayload(message);

    return (
      payload?.kind === 'baseline' &&
      payload.association?.kind === 'checkpoint' &&
      payload.association.checkpointId === checkpointId
    );
  });
}

function findOriginBaseline(
  history: ReadonlyArray<ReplayMessage>,
): ReplayMessage | undefined {
  return history.find((message) => {
    const payload = digestCarrierPayload(message);

    return (
      payload?.kind === 'baseline' &&
      payload.association?.kind === 'origin' &&
      payload.association.chatId === message.chatId
    );
  });
}

type EffectiveReplayMessage = Message;

/** Apply logical digest cutoffs after the repository has loaded its owned rows. */
export function selectEffectiveDigestMessages(
  rows: ReadonlyArray<Message>,
  chatId: string,
  options: EffectiveReplayOptions,
): Array<Message> {
  const checkpoint = options.checkpointId
    ? rows.find(
        (row) => row.id === options.checkpointId && row.role === 'checkpoint',
      )
    : undefined;

  const boundary = checkpoint?.absorbedThroughSeq ?? 0;

  return rows
    .filter((row) =>
      isEffectiveReplayRow(row, { chatId, options, checkpoint, boundary }),
    )
    .sort((left, right) =>
      compareDigestReplayRows(left, right, options.throughSeq),
    );
}

function isEffectiveReplayRow(
  row: EffectiveReplayMessage,
  selection: EffectiveReplaySelection,
): boolean {
  if (row.role !== 'user' && row.role !== 'assistant') return false;

  const payload = digestCarrierPayload(row);

  if (payload !== undefined) {
    return isEffectiveDigestPayload(payload, selection);
  }

  return row.seq > selection.boundary && row.seq < selection.options.throughSeq;
}

function isEffectiveDigestPayload(
  payload: DigestPayload,
  selection: EffectiveReplaySelection,
): boolean {
  const { chatId, options, checkpoint, boundary } = selection;
  const checkpointId = checkpoint?.id;

  if (payload.kind === 'baseline') {
    return (
      (payload.association?.kind === 'origin' &&
        payload.association.chatId === chatId &&
        checkpointId === undefined) ||
      (payload.association?.kind === 'checkpoint' &&
        payload.association.checkpointId === checkpointId)
    );
  }

  return (
    payload.importedCutoff !== undefined &&
    importedDigestMatchesEpoch(payload, chatId, checkpoint) &&
    boundary < payload.importedCutoff.lastOriginalSeq &&
    (options.throughSeq === payload.importedCutoff.latestTurnSeq ||
      options.throughSeq > payload.importedCutoff.lastOriginalSeq)
  );
}

function compareDigestReplayRows(
  left: DigestCarrier & { seq: number },
  right: DigestCarrier & { seq: number },
  throughSeq: number,
): number {
  return (
    digestReplayPosition(left, throughSeq) -
      digestReplayPosition(right, throughSeq) || left.seq - right.seq
  );
}

function digestReplayPosition(
  message: DigestCarrier & { seq: number },
  throughSeq: number,
): number {
  const payload = digestCarrierPayload(message);

  if (payload?.kind === 'baseline') return Number.NEGATIVE_INFINITY;
  const cutoff = payload?.importedCutoff;

  if (cutoff === undefined) return message.seq;

  return throughSeq === cutoff.latestTurnSeq
    ? cutoff.latestTurnSeq - 0.5
    : cutoff.lastOriginalSeq + 0.5;
}

/** Stored trigger items keep their bytes, but only their epoch enters replay. */
export function projectDigestEpochParts(
  parts: Array<unknown>,
  epoch: DigestAssociation,
): Array<unknown> {
  let projected: Array<unknown> | undefined;

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];

    if (digestPartMatchesEpoch(part, epoch)) {
      projected?.push(part);
    } else if (projected === undefined) {
      projected = parts.slice(0, index);
    }
  }

  return projected ?? parts;
}

function digestPartMatchesEpoch(
  part: unknown,
  epoch: DigestAssociation,
): boolean {
  if (!isContextItemPart(part)) return true;
  const payload = readDigestPayload(part);

  if (payload === undefined) return true;
  const association = payload.association;

  if (association === undefined) return epoch.kind === 'origin';

  if (association.kind === 'origin') {
    return epoch.kind === 'origin' && association.chatId === epoch.chatId;
  }

  return (
    epoch.kind === 'checkpoint' &&
    association.checkpointId === epoch.checkpointId
  );
}
