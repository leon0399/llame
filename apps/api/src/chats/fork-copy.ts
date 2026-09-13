/**
 * Owner-fork copy (#154): copy the selected message prefix, applicable
 * compaction lineage, turn evidence, and initial continuation state.
 */

import {
  type Chat,
  type ContinuationStatePayload,
  type Message,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  ChatsRepository,
  CompactionsRepository,
  isCompletedAssistantTurn,
  MessagesRepository,
} from './chats-repository';
import { MessageTurnContextsRepository } from './message-turn-contexts-repository';
import { forkTitle } from './chats.service';
import { throwContextUnavailable } from './fork-conflict';

type CopyScope = {
  tx: Db;
  ownerUserId: string;
  source: Chat;
  destChatId: string;
  msgIdMap: Map<string, string>;
  maxSeq: number;
  /**
   * Acceptance-revision ceiling for an explicit user anchor: inherited
   * state must not exceed it, or a later transition compaction sharing
   * the anchor's message horizon would leak post-acceptance state.
   */
  acceptanceCeiling: number | null;
};

/**
 * Copy the selected message prefix into a new private chat with
 * inherited provenance, applicable compactions, turn evidence, and
 * initial continuation state.
 */
export async function copyOwnerPrefix(input: {
  tx: Db;
  ownerUserId: string;
  source: Chat;
  toCopy: Array<Message>;
  acceptanceCeiling: number | null;
}): Promise<Chat> {
  const { tx, ownerUserId, source, toCopy, acceptanceCeiling } = input;
  const chatsRepo = new ChatsRepository(tx);
  const created = await chatsRepo.create({
    ownerUserId,
    ...(source.title !== null && { title: forkTitle(source.title) }),
    ...(toCopy.length > 0 && {
      inheritedContextOriginAt:
        source.inheritedContextOriginAt ?? source.createdAt,
    }),
  });
  if (toCopy.length > 0) {
    await copyBoundaryState(
      {
        tx,
        ownerUserId,
        source,
        destChatId: created.id,
        maxSeq: toCopy.at(-1)!.seq,
        acceptanceCeiling,
      },
      toCopy,
      chatsRepo,
    );
  }
  return created;
}

/** Copy messages, then the boundary's inherited compaction/evidence state. */
async function copyBoundaryState(
  base: Omit<CopyScope, 'msgIdMap'>,
  toCopy: Array<Message>,
  chatsRepo: ChatsRepository,
): Promise<void> {
  const msgIdMap = new Map(toCopy.map((m) => [m.id, crypto.randomUUID()]));
  await new MessagesRepository(base.tx).createMany(
    toCopy.map((m, i) =>
      mapCopiedMessage(m, i, base.destChatId, {
        idMap: msgIdMap,
        allCopied: toCopy,
      }),
    ),
  );
  const scope: CopyScope = { ...base, msgIdMap };
  const compIdMap = await copyCompactions(scope);
  await copyEvidence(scope, compIdMap);
  await setForkInitialState(scope, compIdMap, chatsRepo);
}

function mapCopiedMessage(
  message: Message,
  index: number,
  destChatId: string,
  ctx: { idMap: Map<string, string>; allCopied: Array<Message> },
) {
  const { idMap, allCopied } = ctx;
  return {
    id: idMap.get(message.id)!,
    chatId: destChatId,
    seq: index + 1,
    role: message.role,
    senderUserId: message.senderUserId,
    parts: message.parts,
    attachments: message.attachments,
    usage: message.usage,
    createdAt: message.createdAt,
    inReplyTo: message.inReplyTo
      ? (idMap.get(message.inReplyTo) ?? null)
      : null,
    inheritedTurnComplete:
      message.inheritedTurnComplete ||
      (message.role === 'user' &&
        allCopied.some(
          (m) =>
            m.role === 'assistant' &&
            m.inReplyTo === message.id &&
            isCompletedAssistantTurn(m),
        )),
    ...(message.usage != null && {
      usageOriginKind: message.usageOriginKind ?? ('message' as const),
      usageOriginId: message.usageOriginId ?? message.id,
      usageProvenanceCol: 'inherited' as const,
    }),
  };
}

/**
 * A compaction's data may be copied when its coverage fits the prefix,
 * but its CONTINUATION companion is eligible only when the state it
 * observed (sourceMaxSeq) also fits. A checkpoint authored from state
 * after the boundary must not import that excluded state merely because
 * its covered prefix ends earlier. Legacy nulls carry no companion.
 */
function isCompanionEligible(
  comp: { companionState: unknown; sourceMaxSeq: number | null },
  maxSeq: number,
): boolean {
  if (!comp.companionState) return false;
  return comp.sourceMaxSeq === null || comp.sourceMaxSeq <= maxSeq;
}

async function copyCompactions(scope: CopyScope): Promise<Map<string, string>> {
  const repo = new CompactionsRepository(scope.tx);
  const all = await repo.findByCoverage(
    scope.source.id,
    scope.ownerUserId,
    scope.maxSeq,
  );
  const idMap = new Map(all.map((c) => [c.id, crypto.randomUUID()]));
  for (const comp of all) {
    await repo.create({
      id: idMap.get(comp.id),
      chatId: scope.destChatId,
      uptoSeq: comp.uptoSeq,
      parentId: comp.parentId ? (idMap.get(comp.parentId) ?? null) : null,
      summary: comp.summary,
      replacementHistory: comp.replacementHistory,
      usage: comp.usage,
      createdAt: comp.createdAt,
      ...(comp.usage != null && {
        usageOriginKind: comp.usageOriginKind ?? ('compaction' as const),
        usageOriginId: comp.usageOriginId ?? comp.id,
        usageProvenanceCol: 'inherited' as const,
      }),
      ...(isCompanionEligible(comp, scope.maxSeq) && {
        companion: {
          contextRevision: comp.contextRevision ?? 0,
          sourceMaxSeq: comp.sourceMaxSeq ?? 0,
          companionActiveCompactionId: comp.companionActiveCompactionId
            ? (idMap.get(comp.companionActiveCompactionId) ?? null)
            : null,
          companionDigestRebakedFrom: comp.companionDigestRebakedFrom
            ? (idMap.get(comp.companionDigestRebakedFrom) ?? null)
            : null,
          companionState: comp.companionState,
        },
      }),
    });
  }
  return idMap;
}

/**
 * Evidence is copied when its message is in the prefix and its recorded
 * revision does not exceed a user anchor's acceptance ceiling.
 */
function isEvidenceEligible(
  ev: { messageId: string; contextRevision: number },
  scope: CopyScope,
): boolean {
  if (!scope.msgIdMap.has(ev.messageId)) return false;
  return (
    scope.acceptanceCeiling === null ||
    ev.contextRevision <= scope.acceptanceCeiling
  );
}

async function copyEvidence(
  scope: CopyScope,
  compIdMap: Map<string, string>,
): Promise<void> {
  const repo = new MessageTurnContextsRepository(scope.tx);
  const all = await repo.findByCoverage(
    scope.source.id,
    scope.ownerUserId,
    scope.maxSeq,
  );
  for (const ev of all) {
    if (!isEvidenceEligible(ev, scope)) continue;
    const destMessageId = scope.msgIdMap.get(ev.messageId);
    if (!destMessageId) continue;
    await repo.create({
      chatId: scope.destChatId,
      originRunId: ev.originRunId,
      messageId: destMessageId,
      ownerUserId: scope.ownerUserId,
      modelId: ev.modelId,
      effort: ev.effort,
      acceptedAt: ev.acceptedAt,
      snapshotId: ev.snapshotId,
      contextRevision: ev.contextRevision,
      sourceMaxSeq: ev.sourceMaxSeq,
      // Checkpoint lineage is remapped through the copied compactions so
      // the inherited evidence keeps addressing the fork's own rows.
      activeCompactionId: ev.activeCompactionId
        ? (compIdMap.get(ev.activeCompactionId) ?? null)
        : null,
      digestBaseline: ev.digestBaseline,
      digestTold: ev.digestTold,
      digestRebakedFrom: ev.digestRebakedFrom
        ? (compIdMap.get(ev.digestRebakedFrom) ?? null)
        : null,
    });
  }
}

async function setForkInitialState(
  scope: CopyScope,
  compIdMap: Map<string, string>,
  chatsRepo: ChatsRepository,
): Promise<void> {
  const latest = await new MessageTurnContextsRepository(
    scope.tx,
  ).findLatestByChatId(scope.destChatId, scope.ownerUserId);
  // Design D4: select the highest eligible contextRevision across the
  // turn records AND the copied compaction companions — a compaction
  // commit is often the newest continuation event at a boundary.
  const compactionState = await latestCompanionState(scope, compIdMap);
  const evidenceState = latest
    ? {
        contextRevision: latest.contextRevision,
        digestBaseline: latest.digestBaseline ?? null,
        digestTold: latest.digestTold ?? null,
      }
    : null;
  // Design D4: the highest eligible revision wins across the turn
  // records, the copied compaction companions, AND the source chat's
  // adoption state — the adoption snapshot is a peer candidate, not
  // merely a last resort.
  const selected = selectHighestRevision([
    evidenceState,
    compactionState,
    selectAdoptionState(scope.source, scope.maxSeq),
  ]);
  if (!selected) {
    throwContextUnavailable(
      'No retained continuation evidence is available at the selected boundary.',
    );
  }
  // The Chat's live digest columns ARE the current continuation state
  // (design D3); without them the fork's first turn renders no inherited
  // digest and initializes a fresh baseline. The counter starts at the
  // highest copied revision before any local authoring.
  await chatsRepo.setForkContinuationState(
    scope.destChatId,
    scope.ownerUserId,
    {
      contextRevision: selected.contextRevision,
      sourceMaxSeq: scope.maxSeq,
      digestBaseline: selected.digestBaseline,
      digestTold: selected.digestTold,
    },
  );
}

type ForkContinuationState = {
  contextRevision: number;
  digestBaseline: ContinuationStatePayload['digestBaseline'];
  digestTold: ContinuationStatePayload['digestTold'];
};

/** The recorded state carrying the highest contextRevision, if any. */
function selectHighestRevision(
  candidates: ReadonlyArray<ForkContinuationState | null>,
): ForkContinuationState | null {
  const present = candidates.filter(
    (s): s is ForkContinuationState => s !== null,
  );
  if (present.length === 0) return null;
  return present.reduce((a, b) =>
    b.contextRevision > a.contextRevision ? b : a,
  );
}

/** The copied compaction companion carrying the highest observed revision. */
async function latestCompanionState(
  scope: CopyScope,
  compIdMap: Map<string, string>,
): Promise<ForkContinuationState | null> {
  const all = await new CompactionsRepository(scope.tx).findByCoverage(
    scope.source.id,
    scope.ownerUserId,
    scope.maxSeq,
  );
  const eligible = all.filter(
    (c) =>
      isCompanionEligible(c, scope.maxSeq) &&
      (scope.acceptanceCeiling === null ||
        (c.contextRevision ?? 0) <= scope.acceptanceCeiling) &&
      compIdMap.has(c.id) &&
      c.companionState !== null,
  );
  if (eligible.length === 0) return null;
  const best = eligible.reduce((a, b) =>
    (b.contextRevision ?? 0) > (a.contextRevision ?? 0) ? b : a,
  );
  return {
    contextRevision: best.contextRevision ?? 0,
    digestBaseline: best.companionState?.digestBaseline ?? null,
    digestTold: best.companionState?.digestTold ?? null,
  };
}

/**
 * The source chat's adoption state, usable only when it was observed at
 * or before the selected boundary. An adoption horizon past the boundary
 * (e.g. an unfinished later turn advanced it) cannot describe this prefix.
 * A chat with no recorded adoption state has genuinely unrecorded history.
 */
function selectAdoptionState(
  source: Chat,
  maxSeq: number,
): {
  contextRevision: number;
  digestBaseline: ContinuationStatePayload['digestBaseline'];
  digestTold: ContinuationStatePayload['digestTold'];
} | null {
  const state = source.initialContinuationState;
  if (!state) return null;
  if (state.sourceMaxSeq > maxSeq) return null;
  return {
    contextRevision: state.contextRevision,
    digestBaseline: state.digestBaseline,
    digestTold: state.digestTold,
  };
}
