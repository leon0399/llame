/**
 * Fork boundary resolution (#154 owner-chat-forks): determines the
 * inclusive maxSeq for the message prefix to copy.
 */

import { NotFoundException } from '@nestjs/common';

import { type Message } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  isCompletedAssistantTurn,
  MessagesRepository,
} from './chats-repository';
import { MessageTurnContextsRepository } from './message-turn-contexts-repository';
import { RunsRepository } from '../runs/runs-repository';
import {
  throwBoundaryUnsettled,
  throwContextUnavailable,
} from './fork-conflict';

type ForkScope = {
  tx: Db;
  messagesRepo: MessagesRepository;
  runsRepo: RunsRepository;
  chatId: string;
  ownerUserId: string;
};

/**
 * The resolved fork boundary.
 *
 * `acceptanceCeiling` is set only for an explicit USER anchor: the
 * acceptance revision recorded for that message. State copied into the
 * fork must not exceed it, or a later transition compaction that merely
 * shares the anchor's message horizon would leak state authored after
 * the anchor was accepted (design D4).
 */
export type ForkBoundary = {
  maxSeq: number;
  acceptanceCeiling: number | null;
};

/** Returns the boundary, or null for an empty fork. */
export async function resolveForkBoundary(
  scope: ForkScope,
  fromMessageId: string | undefined,
): Promise<ForkBoundary | null> {
  if (fromMessageId !== undefined) {
    return resolveExplicitAnchor(scope, fromMessageId);
  }
  const maxSeq = await resolveWholeChatBoundary(scope);
  return maxSeq === null ? null : { maxSeq, acceptanceCeiling: null };
}

/**
 * Whole-chat fork: find the last completed assistant turn with no
 * governing nonterminal Run. Returns null if no completed turn exists.
 */
async function resolveWholeChatBoundary(
  scope: ForkScope,
): Promise<number | null> {
  const { messagesRepo, runsRepo, chatId, ownerUserId } = scope;
  const activeRun = await runsRepo.findActiveByChatId(chatId, ownerUserId);
  const allMessages = await messagesRepo.findByChatId(chatId, ownerUserId);
  if (allMessages.length === 0) return null;

  const activeRunMessageSeq = activeRun?.messageId
    ? allMessages.find((m) => m.id === activeRun.messageId)?.seq
    : undefined;

  for (let i = allMessages.length - 1; i >= 0; i--) {
    const msg = allMessages[i];
    if (msg.role !== 'assistant') continue;
    if (activeRunMessageSeq !== undefined && msg.seq >= activeRunMessageSeq) {
      continue;
    }
    if (isCompletedAssistantTurn(msg)) return msg.seq;
  }
  return null;
}

/** Explicit anchor: resolve the message and validate eligibility. */
async function resolveExplicitAnchor(
  scope: ForkScope,
  fromMessageId: string,
): Promise<ForkBoundary> {
  const { messagesRepo, chatId, ownerUserId } = scope;
  const target = await messagesRepo.findById(
    chatId,
    ownerUserId,
    fromMessageId,
  );
  if (!target) {
    throw new NotFoundException('Fork-point message not found in this chat');
  }
  await rejectIfGoverningNonterminalRun(scope, target.seq);
  if (target.role === 'assistant') {
    if (!isCompletedAssistantTurn(target)) {
      throwBoundaryUnsettled(
        'The selected assistant message is not a completed turn.',
      );
    }
    // A completed assistant boundary admits later applicable state.
    return { maxSeq: target.seq, acceptanceCeiling: null };
  }
  if (target.role === 'user') {
    await validateUserAnchorCompletion(scope, target);
    return {
      maxSeq: target.seq,
      acceptanceCeiling: await resolveAcceptanceCeiling(scope, target),
    };
  }
  throw new NotFoundException('Fork-point message not found in this chat');
}

/**
 * The acceptance revision recorded for a user anchor. This bounds the
 * state the fork may inherit: a later transition compaction carrying the
 * same message horizon but a higher revision belongs after the anchor.
 * An unrecorded acceptance revision cannot bound anything, so the fork
 * fails closed rather than guessing.
 */
async function resolveAcceptanceCeiling(
  scope: ForkScope,
  target: Message,
): Promise<number> {
  const evidence = await new MessageTurnContextsRepository(
    scope.tx,
  ).findByMessageId(scope.chatId, target.id, scope.ownerUserId);
  if (!evidence) {
    throwContextUnavailable(
      'The selected user anchor has no recorded acceptance revision.',
    );
  }
  return evidence.contextRevision;
}

async function rejectIfGoverningNonterminalRun(
  scope: ForkScope,
  targetSeq: number,
): Promise<void> {
  const { messagesRepo, runsRepo, chatId, ownerUserId } = scope;
  const activeRun = await runsRepo.findActiveByChatId(chatId, ownerUserId);
  if (!activeRun?.messageId) return;
  const activeMsg = await messagesRepo.findById(
    chatId,
    ownerUserId,
    activeRun.messageId,
  );
  if (activeMsg && activeMsg.seq <= targetSeq) {
    throwBoundaryUnsettled(
      'The selected message belongs to an unfinished turn.',
    );
  }
}

/** Check user-anchor completion via proven reply or inherited fact. */
async function validateUserAnchorCompletion(
  scope: ForkScope,
  target: Message,
): Promise<void> {
  if (target.inheritedTurnComplete) return;
  const { messagesRepo, chatId, ownerUserId } = scope;
  const allMessages = await messagesRepo.findByChatId(chatId, ownerUserId);
  const hasCompletedReply = allMessages.some(
    (m) =>
      m.role === 'assistant' &&
      m.inReplyTo === target.id &&
      isCompletedAssistantTurn(m),
  );
  if (!hasCompletedReply) {
    throwContextUnavailable('User anchor has no provable completed reply.');
  }
}
