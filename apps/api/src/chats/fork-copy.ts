/**
 * Owner-fork copy (#154): copy the selected message prefix, applicable
 * compaction lineage, turn evidence, and initial continuation state.
 */

import { type Chat, type Message } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  ChatsRepository,
  CompactionsRepository,
  isCompletedAssistantTurn,
  MessagesRepository,
} from './chats-repository';
import { MessageTurnContextsRepository } from './message-turn-contexts-repository';
import { forkTitle } from './chats.service';

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
    await copyCompactions(scope);
    await copyEvidence(scope);
    await setForkInitialState(scope, chatsRepo);
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

async function copyCompactions(scope: CopyScope): Promise<void> {
  const repo = new CompactionsRepository(scope.tx);
  const all = await repo.findByCoverage(
    scope.source.id,
    scope.ownerUserId,
    scope.maxSeq,
  );
  if (all.length === 0) return;
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
      ...(comp.companionState && {
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
}

async function copyEvidence(scope: CopyScope): Promise<void> {
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
      activeCompactionId: null,
      digestBaseline: ev.digestBaseline,
      digestTold: ev.digestTold,
      digestRebakedFrom: null,
    });
  }
}

async function setForkInitialState(
  scope: CopyScope,
  chatsRepo: ChatsRepository,
): Promise<void> {
  const latest = await new MessageTurnContextsRepository(
    scope.tx,
  ).findLatestByChatId(scope.destChatId, scope.ownerUserId);
  if (!latest) return;
  await chatsRepo.setInitialContinuationState(
    scope.destChatId,
    scope.ownerUserId,
    {
      contextRevision: latest.contextRevision,
      sourceMaxSeq: scope.maxSeq,
      digestBaseline: latest.digestBaseline ?? null,
      digestTold: latest.digestTold ?? null,
    },
  );
}
