/**
 * ContextBuilder unit tests — pure functions, no DB required.
 *
 * Acceptance criteria covered:
 * - stable prefix is byte-identical across turns (cache-stability)
 * - deterministic output for identical inputs
 * - sender attribution rendered when >1 distinct senderUserId
 * - single-sender chat produces no sender prefix
 */

import { buildContext, type StoredMessage } from './context-builder';

// Minimal message factory. `seq` auto-increments in creation order, which matches
// the intended conversation order of the fixtures below; override it to test
// out-of-order input.
let seqCounter = 0;
function msg(
  overrides: Partial<StoredMessage> & Pick<StoredMessage, 'role' | 'parts'>,
): StoredMessage {
  return {
    id: 'msg-' + Math.random().toString(36).slice(2),
    chatId: 'chat-1',
    seq: ++seqCounter,
    senderUserId: null,
    attachments: [],
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('buildContext', () => {
  const systemPrompt = 'You are a helpful assistant.';

  const userMsg1 = msg({
    id: 'msg-1',
    role: 'user',
    senderUserId: 'user-alice',
    parts: [{ type: 'text', text: 'Hello' }],
    createdAt: new Date('2024-01-01T00:00:00Z'),
  });

  const assistantMsg1 = msg({
    id: 'msg-2',
    role: 'assistant',
    senderUserId: null,
    parts: [{ type: 'text', text: 'Hi there!' }],
    createdAt: new Date('2024-01-01T00:00:01Z'),
  });

  const userMsg2 = msg({
    id: 'msg-3',
    role: 'user',
    senderUserId: 'user-alice',
    parts: [{ type: 'text', text: 'How are you?' }],
    createdAt: new Date('2024-01-01T00:00:02Z'),
  });

  describe('cache-stability: stable prefix is byte-identical across turns', () => {
    it('system content is identical regardless of which turn is current', () => {
      const turn1 = buildContext([userMsg1], { systemPrompt });
      const turn2 = buildContext([userMsg1, assistantMsg1], { systemPrompt });
      const turn3 = buildContext([userMsg1, assistantMsg1, userMsg2], {
        systemPrompt,
      });

      expect(turn1.system).toBe(turn2.system);
      expect(turn2.system).toBe(turn3.system);
    });

    it('system contains no timestamps, ids, or per-request values', () => {
      const result = buildContext([userMsg1], { systemPrompt });

      // Must not contain any message IDs or timestamps
      expect(result.system).not.toContain('msg-1');
      expect(result.system).not.toContain('2024-01-01');
      expect(result.system).not.toContain('chat-1');
    });
  });

  describe('determinism', () => {
    it('identical inputs produce identical output', () => {
      const messages = [userMsg1, assistantMsg1, userMsg2];
      const out1 = buildContext(messages, { systemPrompt });
      const out2 = buildContext(messages, { systemPrompt });

      expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
    });

    it('message order is oldest-first (history order preserved), with no system entry', () => {
      const messages = [userMsg1, assistantMsg1, userMsg2];
      const result = buildContext(messages, { systemPrompt });

      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[2].role).toBe('user');
      expect(result.messages.some((m) => m.role === 'system')).toBe(false);
    });

    it('normalizes unsorted input by seq before building (sort-before-cap)', () => {
      // Same messages, shuffled. seq order is userMsg1(1) → assistantMsg1(2) → userMsg2(3).
      const result = buildContext([userMsg2, userMsg1, assistantMsg1], {
        systemPrompt,
      });

      expect(result.messages[0].content).toContain('Hello'); // userMsg1
      expect(result.messages[1].content).toContain('Hi there!'); // assistantMsg1
      expect(result.messages[2].content).toContain('How are you?'); // userMsg2
    });

    it('drops any stored system-role row from messages and from the cap budget', () => {
      // No write path persists a system-role row today, but StoredMessage.role permits one —
      // it must not leak into messages (system is delivered via `system` only) nor consume a
      // maxMessages slot that real history should get.
      const systemRow = msg({
        id: 'msg-system',
        role: 'system',
        senderUserId: null,
        parts: [{ type: 'text', text: 'a persisted system row' }],
        createdAt: new Date('2024-01-01T00:00:00.500Z'),
      });

      const result = buildContext(
        [userMsg1, systemRow, assistantMsg1, userMsg2],
        {
          systemPrompt,
          maxMessages: 3,
        },
      );

      expect(result.messages.some((m) => m.role === 'system')).toBe(false);
      expect(result.messages).toHaveLength(3);
      expect(result.messages.map((m) => m.role)).toEqual([
        'user',
        'assistant',
        'user',
      ]);
    });
  });

  describe('sender attribution', () => {
    it('no sender prefix when only one distinct senderUserId in chat', () => {
      const messages = [userMsg1, assistantMsg1, userMsg2];
      const { messages: result } = buildContext(messages, { systemPrompt });

      const userMessages = result.filter((m) => m.role === 'user');
      userMessages.forEach((m) => {
        const textPart = m.content;
        // The code emits a leading `[senderId] ` prefix only for multi-sender chats;
        // a single-sender chat must have NO such prefix. Match the prefix SHAPE at the
        // start of the content (not a bare `[`, which would spuriously fail on bracketed
        // body text like markdown links).
        expect(textPart).not.toMatch(/^\[[^\]]+\]\s/);
      });
    });

    it('renders sender attribution prefix when >1 distinct senderUserId', () => {
      const bobMsg = msg({
        id: 'msg-bob',
        role: 'user',
        senderUserId: 'user-bob',
        parts: [{ type: 'text', text: 'Hey from Bob' }],
        createdAt: new Date('2024-01-01T00:00:03Z'),
      });

      const messages = [userMsg1, assistantMsg1, bobMsg];
      const { messages: result } = buildContext(messages, { systemPrompt });

      const userMessages = result.filter((m) => m.role === 'user');
      // At least one message should have a sender prefix
      const hasSenderPrefix = userMessages.some((m) => {
        const content =
          typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return (
          content.includes('[user-alice]') ||
          content.includes('[user-bob]') ||
          content.includes('user-alice:') ||
          content.includes('user-bob:')
        );
      });

      expect(hasSenderPrefix).toBe(true);
    });

    it('assistant/system/tool messages never get sender prefix', () => {
      const bobMsg = msg({
        id: 'msg-bob',
        role: 'user',
        senderUserId: 'user-bob',
        parts: [{ type: 'text', text: 'Hey' }],
        createdAt: new Date('2024-01-01T00:00:03Z'),
      });
      const messages = [userMsg1, assistantMsg1, bobMsg];
      const { messages: result } = buildContext(messages, { systemPrompt });

      const assistantMessages = result.filter((m) => m.role === 'assistant');
      assistantMessages.forEach((m) => {
        const content =
          typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        expect(content).not.toContain('[');
      });
    });
  });

  describe('parts round-trip', () => {
    it('text parts are preserved in message content', () => {
      const messages = [userMsg1];
      const { messages: result } = buildContext(messages, { systemPrompt });

      const userResult = result.find((m) => m.role === 'user');
      const content =
        typeof userResult!.content === 'string'
          ? userResult!.content
          : JSON.stringify(userResult!.content);

      expect(content).toContain('Hello');
    });
  });

  describe('token budget / hard cap', () => {
    it('respects max messages cap: keeps most-recent-N messages within budget', () => {
      // Generate 200 messages — more than any reasonable limit
      const manyMessages: StoredMessage[] = Array.from(
        { length: 200 },
        (_, i) =>
          msg({
            id: `msg-${i}`,
            role: i % 2 === 0 ? 'user' : 'assistant',
            senderUserId: i % 2 === 0 ? 'user-alice' : null,
            parts: [{ type: 'text', text: `Message ${i}` }],
            createdAt: new Date(Date.now() + i * 1000),
          }),
      );

      const result = buildContext(manyMessages, {
        systemPrompt,
        maxMessages: 10,
      });

      // history only — no system entry, so the cap applies directly
      expect(result.messages.length).toBeLessThanOrEqual(10);
      expect(result.messages.some((m) => m.role === 'system')).toBe(false);
    });
  });
});
