/**
 * ContextBuilder unit tests — pure functions, no DB required.
 *
 * Acceptance criteria covered:
 * - stable prefix is byte-identical across turns (cache-stability)
 * - deterministic output for identical inputs
 * - sender attribution rendered when >1 distinct senderUserId
 * - single-sender chat produces no sender prefix
 */

import {
  buildContext,
  partsToText,
  type MessagePart,
  type StoredMessage,
} from './context-builder';

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

    it('drops any stored system-role row from messages', () => {
      // No write path persists a system-role row today, but StoredMessage.role permits one —
      // it must not leak into messages (system is delivered via `system` only).
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

    it('reasoning parts are STRIPPED from model context (never re-fed)', () => {
      const assistant = msg({
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'SECRET_THINKING should not re-feed' },
          { type: 'text', text: 'The visible answer' },
        ],
      });
      const { messages: result } = buildContext([userMsg1, assistant], {
        systemPrompt,
      });
      const serialized = JSON.stringify(result);
      // The persisted reasoning must not appear in the model input …
      expect(serialized).not.toContain('SECRET_THINKING');
      // … while the answer text still does.
      expect(serialized).toContain('The visible answer');
    });

    it('tool-activity and cap-notice parts are STRIPPED from model context (never re-fed)', () => {
      // A search_conversations result (other chats' snippets) and the cap
      // marker are display-only: they must not re-enter model context on a
      // later turn as a JSON.stringify'd assistant history entry — that would
      // re-present tool observations as the model's own authoritative output
      // and re-expose any injected snippet content (D8).
      const assistant = msg({
        role: 'assistant',
        parts: [
          {
            type: 'tool-search_conversations',
            toolCallId: 'call-1',
            state: 'output-available',
            input: { query: 'holidays' },
            output: {
              status: 'success',
              matches: [
                { snippet: 'INJECTED_TOOL_SNIPPET should not re-feed' },
              ],
            },
          },
          { type: 'data-cap-notice', data: { stepsUsed: 8, maxSteps: 8 } },
          { type: 'text', text: 'Here is what I found.' },
        ],
      });
      const { messages: result } = buildContext([userMsg1, assistant], {
        systemPrompt,
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('INJECTED_TOOL_SNIPPET');
      expect(serialized).not.toContain('data-cap-notice');
      expect(serialized).not.toContain('tool-search_conversations');
      // … the visible answer text still reaches the model.
      expect(serialized).toContain('Here is what I found.');
    });

    it('partsToText does not throw on a malformed part (no runtime schema on jsonb)', () => {
      // `parts` is jsonb with no runtime validation — a legacy row or a bug
      // elsewhere could persist a non-object entry. isDisplayOnlyPart must
      // guard before `'type' in part`, like isTextPart already does, or this
      // throws.
      const malformed = [
        null,
        'a bare string',
        { type: 'text', text: 'still here' },
      ] as unknown as MessagePart[];

      expect(() => partsToText(malformed)).not.toThrow();
      expect(partsToText(malformed)).toContain('still here');
    });
  });

  describe('compaction (lineage-based, #57)', () => {
    const compaction = {
      summary: 'User is planning a trip to Japan; budget agreed at $3000.',
      uptoSeq: 2,
    };

    it('drops superseded messages (seq <= uptoSeq) and injects the summary first', () => {
      const result = buildContext([userMsg1, assistantMsg1, userMsg2], {
        systemPrompt,
        compaction,
      });

      // userMsg1 (seq 1) and assistantMsg1 (seq 2) are superseded; userMsg2 (seq 3) stays.
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toContain(compaction.summary);
      expect(result.messages[1].content).toContain('How are you?');
    });

    it('keeps the system prompt byte-identical with and without compaction', () => {
      const without = buildContext([userMsg2], { systemPrompt });
      const withCompaction = buildContext([userMsg1, assistantMsg1, userMsg2], {
        systemPrompt,
        compaction,
      });

      expect(withCompaction.system).toBe(without.system);
      expect(withCompaction.system).toBe(systemPrompt);
    });

    it('leads with the summary and keeps the full live window after it', () => {
      const recent: StoredMessage[] = Array.from({ length: 5 }, (_, i) =>
        msg({
          id: `recent-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          senderUserId: i % 2 === 0 ? 'user-alice' : null,
          seq: 10 + i,
          parts: [{ type: 'text', text: `Recent ${i}` }],
        }),
      );

      const result = buildContext(recent, {
        systemPrompt,
        compaction: { summary: 'summary', uptoSeq: 9 },
      });

      // 1 summary entry + all 5 live messages
      expect(result.messages).toHaveLength(6);
      expect(result.messages[0].content).toContain('summary');
      expect(result.messages[1].content).toContain('Recent 0');
    });

    it('is deterministic with a compaction present', () => {
      const input = [userMsg1, assistantMsg1, userMsg2];
      const out1 = buildContext(input, { systemPrompt, compaction });
      const out2 = buildContext(input, { systemPrompt, compaction });

      expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
    });
  });

  describe('no message-count cap', () => {
    it('renders the full window — token budgeting is the compaction threshold, not a count (#57)', () => {
      // Many SHORT messages can sit far below the token threshold; a count cap
      // would silently drop the oldest without any summary covering them.
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

      const result = buildContext(manyMessages, { systemPrompt });

      expect(result.messages).toHaveLength(200);
      expect(result.messages[0].content).toContain('Message 0');
      expect(result.messages.some((m) => m.role === 'system')).toBe(false);
    });
  });
});
