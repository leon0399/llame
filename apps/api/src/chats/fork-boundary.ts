/**
 * Fork boundary resolution (#154 owner-chat-forks): determines the
 * inclusive maxSeq for the message prefix to copy.
 */

import { NotFoundException } from '@nestjs/common';

import { type Message } from '../db/schema';
import {
  isCompletedAssistantTurn,
  MessagesRepository,
} from './chats-repository';
import { RunsRepository } from '../runs/runs-repository';
import {
  throwBoundaryUnsettled,
  throwContextUnavailable,
} from './fork-conflict';

type ForkScope = {
  messagesRepo: MessagesRepository;
  runsRepo: RunsRepository;
  chatId: string;
  ownerUserId: string;
};

/** Returns the inclusive maxSeq, or null for an empty fork. */
export async function resolveForkBoundary(
  scope: ForkScope,
  fromMessageId: string | undefined,
): Promise<number | null> {
  if (fromMessageId !== undefined) {
    return resolveExplicitAnchor(scope, fromMessageId);
  }
  return resolveWholeChatBoundary(scope);
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
): Promise<number> {
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
    return target.seq;
  }
  if (target.role === 'user') {
    await validateUserAnchorCompletion(scope, target);
    return target.seq;
  }
  throw new NotFoundException('Fork-point message not found in this chat');
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
