/**
 * Compaction planning unit tests (#57) — pure functions, no DB required.
 *
 * Acceptance criteria covered here:
 * - compaction triggers BEFORE the context limit (real usage preferred, estimate fallback)
 * - the threshold derives from the model's context window unless explicitly overridden
 * - the plan absorbs older turns and keeps recent ones verbatim
 * - the summarization request is a cache-aligned continuation of the chat itself:
 *   same system prompt, same history rendering, instruction as the final user message
 */

import {
  COMPACTION_INSTRUCTION,
  COMPACTION_WINDOW_RATIO,
  buildCompactionRequest,
  estimateContextTokens,
  planCompaction,
  resolveCompactionThreshold,
} from './compaction';
import { COMPACTION_SUMMARY_HEADER } from '../chats/context-builder';
import type { StoredMessage } from '../chats/context-builder';

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

describe('resolveCompactionThreshold', () => {
  it('prefers the explicit override over everything', () => {
    expect(
      resolveCompactionThreshold({
        explicitThresholdTokens: 500,
        contextWindowTokens: 1_000_000,
      }),
    ).toBe(500);
  });

  it('derives from the context window when no explicit override is set', () => {
    expect(resolveCompactionThreshold({ contextWindowTokens: 1_000_000 })).toBe(
      Math.floor(1_000_000 * COMPACTION_WINDOW_RATIO),
    );
  });

  it('ignores a NaN/garbage explicit override and derives from the window', () => {
    // No unknown-window fallback exists any more: the window is a required
    // field on every model, so resolveCompactionThreshold always has one and a
    // garbage explicit override simply falls through to it.
    expect(
      resolveCompactionThreshold({
        explicitThresholdTokens: Number.NaN,
        contextWindowTokens: 200_000,
      }),
    ).toBe(Math.floor(200_000 * COMPACTION_WINDOW_RATIO));
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

  it('prefers real measured usage over the estimate (triggers on measured)', () => {
    // Tiny history — the estimate alone would never trigger.
    const history = [msg('short'), msg('short', 'assistant'), msg('short')];

    const plan = planCompaction({
      history,
      previousSummary: undefined,
      thresholdTokens: 1_000,
      keepRecentMessages: 1,
      measuredContextTokens: 5_000,
    });

    expect(plan).not.toBeNull();
  });

  it('prefers real measured usage over the estimate (suppresses on measured)', () => {
    // Huge history by estimate, but the provider reported a small real prompt.
    const history = [
      msg('x'.repeat(40_000)),
      msg('y'.repeat(40_000)),
      msg('z'),
    ];

    const plan = planCompaction({
      history,
      previousSummary: undefined,
      thresholdTokens: 1_000,
      keepRecentMessages: 1,
      measuredContextTokens: 10,
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
  const CHAT_SYSTEM = 'You are llame, an answer-only assistant.';

  it('reuses the chat system prompt and ends with the summarize instruction as a user turn', () => {
    const absorb = [
      msg('plan a trip to Japan'),
      msg('sure — when?', 'assistant'),
    ];

    const request = buildCompactionRequest({
      system: CHAT_SYSTEM,
      previous: undefined,
      absorb,
    });

    // Cache alignment: the system prompt is the chat's own, verbatim — a swapped
    // summarizer prompt would invalidate the whole provider prompt-cache prefix.
    expect(request.system).toBe(CHAT_SYSTEM);
    expect(request.messages[0]).toEqual({
      role: 'user',
      content: expect.stringContaining('plan a trip to Japan') as string,
    });
    expect(request.messages[1].role).toBe('assistant');
    const last = request.messages[request.messages.length - 1];
    expect(last).toEqual({ role: 'user', content: COMPACTION_INSTRUCTION });
  });

  it('renders the previous summary exactly as the live turn did (same header), before absorbed turns', () => {
    const request = buildCompactionRequest({
      system: CHAT_SYSTEM,
      previous: {
        summary: 'User is planning a trip; budget $3000.',
        uptoSeq: 0,
      },
      absorb: [msg('actually make it $4000')],
    });

    // Byte-identical prefix with the chat turn: the summary block leads the
    // history using the ContextBuilder's own header.
    expect(request.messages[0]).toEqual({
      role: 'user',
      content: `${COMPACTION_SUMMARY_HEADER}\nUser is planning a trip; budget $3000.`,
    });
    const rendered = request.messages.map((m) => m.content).join('\n');
    expect(rendered.indexOf('budget $3000')).toBeLessThan(
      rendered.indexOf('$4000'),
    );
  });

  it('never trims absorbed turns — every absorbed message reaches the summarizer', () => {
    const absorb = Array.from({ length: 150 }, (_, i) => msg(`turn ${i}`));

    const request = buildCompactionRequest({
      system: CHAT_SYSTEM,
      previous: undefined,
      absorb,
    });

    // 150 absorbed turns + trailing instruction — nothing dropped.
    expect(request.messages).toHaveLength(151);
    expect(request.messages[0].content).toContain('turn 0');
  });

  it('skips system rows and renders tool rows like the live turn does', () => {
    const request = buildCompactionRequest({
      system: CHAT_SYSTEM,
      previous: undefined,
      absorb: [
        msg('system-only directive', 'system'),
        msg('tool output payload', 'tool'),
        msg('assistant answer', 'assistant'),
      ],
    });

    expect(request.messages).toEqual([
      // Same rendering as ContextBuilder gives the live turn (cache alignment);
      // v0.1 stores no tool rows, this just pins the shared code path.
      { role: 'tool', content: 'tool output payload' },
      { role: 'assistant', content: 'assistant answer' },
      { role: 'user', content: COMPACTION_INSTRUCTION },
    ]);
  });
});
