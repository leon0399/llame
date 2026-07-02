/**
 * Compaction planning unit tests (#57) — pure functions, no DB required.
 *
 * Acceptance criteria covered here:
 * - compaction triggers BEFORE the context limit (threshold on estimated tokens)
 * - the plan absorbs older turns and keeps recent ones verbatim
 * - the summarization request carries prior summary + absorbed turns (lineage-safe)
 */

import {
  COMPACTION_SYSTEM_PROMPT,
  buildCompactionRequest,
  estimateContextTokens,
  planCompaction,
} from './compaction';
import type { StoredMessage } from './context-builder';

let seqCounter = 0;
function msg(
  text: string,
  role: 'user' | 'assistant' | 'system' | 'tool' = 'user',
): StoredMessage {
  return {
    id: 'msg-' + Math.random().toString(36).slice(2),
    chatId: 'chat-1',
    seq: ++seqCounter,
    role,
    senderUserId: role === 'user' ? 'user-1' : null,
    parts: [{ type: 'text', text }],
    attachments: [],
    createdAt: new Date('2024-01-01T00:00:00Z'),
  };
}

beforeEach(() => {
  seqCounter = 0;
});

describe('estimateContextTokens', () => {
  it('estimates ~chars/4 across history and summary', () => {
    const history = [msg('a'.repeat(400)), msg('b'.repeat(400), 'assistant')];

    // 800 chars history + 400 chars summary ≈ 300 tokens
    expect(
      estimateContextTokens(history, 'c'.repeat(400)),
    ).toBeGreaterThanOrEqual(300);
    expect(estimateContextTokens(history, undefined)).toBeGreaterThanOrEqual(
      200,
    );
    expect(estimateContextTokens([], undefined)).toBe(0);
  });
});

describe('planCompaction', () => {
  it('returns null when the estimated context is under the threshold', () => {
    const history = [msg('short question'), msg('short answer', 'assistant')];

    const plan = planCompaction({
      history,
      previousSummary: undefined,
      thresholdTokens: 1_000,
      keepRecentMessages: 1,
    });

    expect(plan).toBeNull();
  });

  it('absorbs everything except the most recent N when over threshold', () => {
    const history = [
      msg('x'.repeat(400)), // seq 1
      msg('y'.repeat(400), 'assistant'), // seq 2
      msg('z'.repeat(400)), // seq 3
      msg('w'.repeat(400), 'assistant'), // seq 4
    ];

    const plan = planCompaction({
      history,
      previousSummary: undefined,
      thresholdTokens: 100, // 1600 chars ≈ 400 tokens > 100
      keepRecentMessages: 2,
    });

    expect(plan).not.toBeNull();
    expect(plan!.uptoSeq).toBe(2); // absorbed seq 1..2, kept 3..4
    expect(plan!.absorb.map((m) => m.seq)).toEqual([1, 2]);
  });

  it('returns null when there is nothing older than the keep window, even over threshold', () => {
    const history = [msg('x'.repeat(4000)), msg('y'.repeat(4000), 'assistant')];

    const plan = planCompaction({
      history,
      previousSummary: undefined,
      thresholdTokens: 100,
      keepRecentMessages: 2,
    });

    expect(plan).toBeNull();
  });

  it('counts the previous summary toward the threshold (re-compaction)', () => {
    const history = [
      msg('short'), // seq 1
      msg('short', 'assistant'), // seq 2
      msg('short'), // seq 3
    ];

    // History alone is tiny; a large prior summary pushes it over.
    const plan = planCompaction({
      history,
      previousSummary: 's'.repeat(4_000),
      thresholdTokens: 500,
      keepRecentMessages: 1,
    });

    expect(plan).not.toBeNull();
    expect(plan!.uptoSeq).toBe(2);
  });
});

describe('buildCompactionRequest', () => {
  it('renders absorbed turns as history and ends with the summarize instruction', () => {
    const absorb = [
      msg('plan a trip to Japan'),
      msg('sure — when?', 'assistant'),
    ];

    const request = buildCompactionRequest({
      previousSummary: undefined,
      absorb,
    });

    expect(request.system).toBe(COMPACTION_SYSTEM_PROMPT);
    expect(request.messages[0]).toEqual({
      role: 'user',
      content: expect.stringContaining('plan a trip to Japan') as string,
    });
    expect(request.messages[1].role).toBe('assistant');
    // Final message is the instruction, and it is a user turn.
    const last = request.messages[request.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content.toLowerCase()).toContain('summar');
  });

  it('carries the previous summary so lineage loses nothing on re-compaction', () => {
    const request = buildCompactionRequest({
      previousSummary: 'User is planning a trip; budget $3000.',
      absorb: [msg('actually make it $4000')],
    });

    const rendered = request.messages.map((m) => m.content).join('\n');
    expect(rendered).toContain('budget $3000');
    expect(rendered).toContain('$4000');
    // Previous summary comes before the newly absorbed turns.
    expect(rendered.indexOf('budget $3000')).toBeLessThan(
      rendered.indexOf('$4000'),
    );
  });

  it('skips system rows and flattens tool rows for summarization', () => {
    const request = buildCompactionRequest({
      previousSummary: undefined,
      absorb: [
        msg('system-only directive', 'system'),
        msg('tool output payload', 'tool'),
        msg('assistant answer', 'assistant'),
      ],
    });

    expect(request.messages).toEqual([
      { role: 'user', content: 'tool output payload' },
      { role: 'assistant', content: 'assistant answer' },
      expect.objectContaining({ role: 'user' }),
    ]);
  });
});
