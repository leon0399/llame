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
};

/**
 * Copy the selected message prefix into a new private chat with
 * inherited provenance, applicable compactions, turn evidence, and
 * initial continuation state.
 */
export async function copyOwnerPrefix(
  tx: Db,
  ownerUserId: string,
  source: Chat,
  toCopy: Array<Message>,
): Promise<Chat> {
  const chatsRepo = new ChatsRepository(tx);
  const created = await chatsRepo.create({
    ownerUserId,
    ...(source.title !== null && { title: forkTitle(source.title) }),
    ...(toCopy.length > 0 && {
      inheritedContextOriginAt:
        source.inheritedContextOriginAt ?? source.createdAt,
    }),
  });
  const msgIdMap = new Map(toCopy.map((m) => [m.id, crypto.randomUUID()]));
  await new MessagesRepository(tx).createMany(
    toCopy.map((m, i) =>
      mapCopiedMessage(m, i, created.id, {
        idMap: msgIdMap,
        allCopied: toCopy,
      }),
    ),
  );
  if (toCopy.length > 0) {
    const scope: CopyScope = {
      tx,
      ownerUserId,
      source,
      destChatId: created.id,
      msgIdMap,
      maxSeq: toCopy.at(-1)!.seq,
    };
    // Compactions first: the copied evidence remaps its checkpoint
    // references through the same ID map.
    const compIdMap = await copyCompactions(scope);
    await copyEvidence(scope, compIdMap);
    await setForkInitialState(scope, compIdMap, chatsRepo);
  }
  return created;
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
  // Fall back to the source chat's immutable adoption state when the
  // copied prefix retained no per-turn evidence.
  const selected =
    selectHighestRevision([evidenceState, compactionState]) ??
    selectAdoptionState(scope.source, scope.maxSeq);
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
