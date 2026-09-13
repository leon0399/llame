/**
 * Unit tests for fork-boundary resolution (#154). These exercise the
 * boundary predicate directly (whole-chat cutoff, explicit anchors,
 * governing nonterminal Runs) with mocked repositories, so mutation
 * coverage lands on the decision logic rather than integration plumbing.
 */

import { NotFoundException, ConflictException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import { type Chat, type Message, type Run } from '../db/schema';
import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { resolveForkBoundary } from './fork-boundary';
import { MessagesRepository } from './messages-repository';
import { RunsRepository } from '../runs/runs-repository';

const chatId = 'chat-1';
const ownerUserId = 'owner-1';

function message(seq: number, overrides: Partial<Message> = {}): Message {
  return {
    id: `message-${seq}`,
    chatId,
    seq,
    role: 'user',
    senderUserId: ownerUserId,
    parts: [],
    attachments: [],
    usage: null,
    inReplyTo: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    inheritedTurnComplete: false,
    usageOriginKind: null,
    usageOriginId: null,
    usageProvenanceCol: null,
    ...overrides,
  };
}

function activeRun(messageId: string): Run {
  return {
    id: 'run-active',
    chatId,
    messageId,
    userId: ownerUserId,
    modelId: 'model-1',
    modelContextSnapshotId: null,
    status: 'running_model',
    workerId: null,
    cancelRequestedAt: null,
    error: null,
    contextItems: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    effort: null,
  };
}

const completedAssistant = (seq: number, inReplyTo?: string) =>
  message(seq, {
    role: 'assistant',
    senderUserId: null,
    usage: { status: 'completed' },
    ...(inReplyTo !== undefined && { inReplyTo }),
  });

function makeScope(options: {
  messages: Array<Message>;
  activeRun?: Run;
  target?: Message;
}) {
  const db: Db = drizzle.mock({ schema });
  const messagesRepo = new MessagesRepository(db);
  const runsRepo = new RunsRepository(db);
  vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue(
    options.messages,
  );
  vi.spyOn(MessagesRepository.prototype, 'findById').mockResolvedValue(
    options.target,
  );
  vi.spyOn(RunsRepository.prototype, 'findActiveByChatId').mockResolvedValue(
    options.activeRun,
  );
  return { messagesRepo, runsRepo, chatId, ownerUserId };
}

describe('resolveForkBoundary', () => {
  it('returns null for a chat with no messages', async () => {
    const scope = makeScope({ messages: [] });
    await expect(resolveForkBoundary(scope, undefined)).resolves.toBeNull();
  });

  it('returns null when no completed assistant turn exists', async () => {
    const scope = makeScope({
      messages: [
        message(1),
        message(2, {
          role: 'assistant',
          senderUserId: null,
          usage: { status: 'failed' },
        }),
      ],
    });
    // A failed assistant turn establishes no boundary.
    await expect(resolveForkBoundary(scope, undefined)).resolves.toBeNull();
  });

  it('stops at the last completed assistant turn', async () => {
    const scope = makeScope({
      messages: [message(1), completedAssistant(2), message(3)],
    });
    await expect(resolveForkBoundary(scope, undefined)).resolves.toBe(2);
  });

  it('excludes turns at or after a governing nonterminal Run', async () => {
    const run = activeRun('message-3');
    const scope = makeScope({
      messages: [message(1), completedAssistant(2), message(3)],
      activeRun: run,
    });
    // The active Run's trigger (seq 3) and anything after is excluded.
    await expect(resolveForkBoundary(scope, undefined)).resolves.toBe(2);
  });

  it('ignores an active Run whose message is absent from the prefix', async () => {
    const run = activeRun('not-in-list');
    const scope = makeScope({
      messages: [message(1), completedAssistant(2)],
      activeRun: run,
    });
    await expect(resolveForkBoundary(scope, undefined)).resolves.toBe(2);
  });

  it('404s an unknown anchor message', async () => {
    const scope = makeScope({ messages: [], target: undefined });
    await expect(resolveForkBoundary(scope, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('accepts a completed assistant anchor inclusively', async () => {
    const anchor = completedAssistant(2);
    const scope = makeScope({ messages: [anchor], target: anchor });
    await expect(resolveForkBoundary(scope, anchor.id)).resolves.toBe(2);
  });

  it('409s an unfinished assistant anchor', async () => {
    const anchor = message(2, {
      role: 'assistant',
      usage: { status: 'failed' },
    });
    const scope = makeScope({ messages: [anchor], target: anchor });
    const rejected = resolveForkBoundary(scope, anchor.id);
    await expect(rejected).rejects.toBeInstanceOf(ConflictException);
    await expect(rejected).rejects.toMatchObject({
      response: { code: 'fork_boundary_unsettled' },
    });
  });

  it('409s an anchor governed by a nonterminal Run at or before it', async () => {
    const anchor = completedAssistant(5);
    const scope = makeScope({
      messages: [anchor],
      target: anchor,
      activeRun: activeRun('message-5'),
    });
    const rejected = resolveForkBoundary(scope, anchor.id);
    await expect(rejected).rejects.toMatchObject({
      response: { code: 'fork_boundary_unsettled' },
    });
  });

  it('accepts a user anchor with a proven completed reply', async () => {
    const user = message(1);
    const scope = makeScope({
      messages: [user, completedAssistant(2, user.id)],
      target: user,
    });
    await expect(resolveForkBoundary(scope, user.id)).resolves.toBe(1);
  });

  it('accepts a user anchor carrying the inherited completion fact', async () => {
    const user = message(1, { inheritedTurnComplete: true });
    const scope = makeScope({ messages: [user], target: user });
    await expect(resolveForkBoundary(scope, user.id)).resolves.toBe(1);
  });

  it('409s a user anchor with no provable completion', async () => {
    const user = message(1);
    const scope = makeScope({ messages: [user], target: user });
    const rejected = resolveForkBoundary(scope, user.id);
    await expect(rejected).rejects.toMatchObject({
      response: { code: 'fork_context_unavailable' },
    });
  });

  it('does not treat an unlinked assistant as the user reply', async () => {
    const user = message(1);
    // A completed assistant that is NOT a reply to this user.
    const scope = makeScope({
      messages: [user, completedAssistant(2, undefined)],
      target: user,
    });
    await expect(resolveForkBoundary(scope, user.id)).rejects.toMatchObject({
      response: { code: 'fork_context_unavailable' },
    });
  });

  it('does not treat an incomplete reply as proving completion', async () => {
    const user = message(1);
    const failedReply = message(2, {
      role: 'assistant',
      senderUserId: null,
      usage: { status: 'failed' },
      inReplyTo: user.id,
    });
    const scope = makeScope({
      messages: [user, failedReply],
      target: user,
    });
    await expect(resolveForkBoundary(scope, user.id)).rejects.toMatchObject({
      response: { code: 'fork_context_unavailable' },
    });
  });

  it('404s a system or tool anchor', async () => {
    const system = message(1, { role: 'system', senderUserId: null });
    const scope = makeScope({ messages: [system], target: system });
    await expect(resolveForkBoundary(scope, system.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('treats absent usage as a completed turn', async () => {
    // Legacy assistant rows with no usage count as complete.
    const legacy = message(4, { role: 'assistant', senderUserId: null });
    const scope = makeScope({ messages: [message(1), legacy] });
    await expect(resolveForkBoundary(scope, undefined)).resolves.toBe(4);
  });

  it('skips a non-assistant tail when finding the boundary', async () => {
    const scope = makeScope({
      messages: [
        message(1),
        completedAssistant(2),
        message(3),
        message(4, { role: 'tool', senderUserId: null }),
      ],
    });
    await expect(resolveForkBoundary(scope, undefined)).resolves.toBe(2);
  });
});

describe('fork boundary scope chat shape', () => {
  it('is typed against Chat for compile-time safety', () => {
    const chat: Pick<Chat, 'id' | 'ownerUserId'> = { id: chatId, ownerUserId };
    expect(chat.id).toBe('chat-1');
  });
});
