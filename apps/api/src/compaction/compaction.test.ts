/**
 * Compaction planning unit tests (#57) — pure functions, no DB required.
 *
 * Acceptance criteria covered here:
 * - the threshold derives from the model's context window unless explicitly overridden
 * - one pre-step publication absorbs every turn between the active checkpoint and the
 *   triggering user message, which is never itself absorbed
 * - the measurement is the previous completed run's counted reply — gated by the user TURN
 *   it answers rather than by the reply's own sequence — plus the estimate of the rows and
 *   staged rail items a prepared request adds on top of it
 * - the summarization request is a cache-aligned continuation of the chat itself:
 *   same system prompt, same history rendering, instruction as the final user message
 */

import {
  COMPACTION_INSTRUCTION,
  COMPACTION_WINDOW_RATIO,
  TRANSITION_COMPACTION_INSTRUCTION,
  buildCompactionRequest,
  countedContextTokens,
  estimateContinuationTokens,
  estimateModelRequestTokens,
  isPositiveFinite,
  planCompactionCheckpoint,
  requestFitsContextWindow,
  normalizeCompactionSummary,
  resolveCompactionThreshold,
} from './compaction';
import { createToolAvailabilityItem } from '../chats/context-item-producers';
import type { StoredMessage } from '../chats/context-builder';
import { isRecord, isString } from '@workspace/runtime-safety';
import type { Message } from '../db/schema';

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

/**
 * A stored `messages` row: the measurement path reads the reply's persisted
 * usage and its `in_reply_to`, neither of which the projection fixture carries.
 */
function row(
  seq: number,
  role: Message['role'],
  overrides?: Partial<Message>,
): Message {
  return {
    id: `message-${seq}`,
    chatId: 'chat-1',
    seq,
    role,
    senderUserId: role === 'user' ? 'user-1' : null,
    parts: [{ type: 'text', text: `message ${seq}` }],
    attachments: [],
    usage: null,
    inReplyTo: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    absorbedThroughSeq: null,
    ...overrides,
  };
}

beforeEach(() => {
  seqCounter = 0;
});

/** User content is a block array now; flatten it for text assertions. */
function contentText(content: unknown): string {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .map((part) =>
      isRecord(part) && isString(part['text']) ? part['text'] : '',
    )
    .join('\n\n');
}

describe('target request preflight', () => {
  it('counts the target prompt, portable messages, and exact tool declarations', () => {
    const base = estimateModelRequestTokens({
      system: 'S'.repeat(400),
      messages: [{ role: 'user', content: 'M'.repeat(400) }],
      toolDeclarations: [],
    });
    const withTools = estimateModelRequestTokens({
      system: 'S'.repeat(400),
      messages: [{ role: 'user', content: 'M'.repeat(400) }],
      toolDeclarations: [
        {
          id: 'lookup',
          description: 'D'.repeat(400),
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
          },
        },
      ],
    });

    expect(base).toBeGreaterThanOrEqual(200);
    expect(withTools).toBeGreaterThan(base);
  });

  it('reserves configured output tokens and treats null as zero', () => {
    const request = {
      system: 'S'.repeat(200),
      messages: [{ role: 'user' as const, content: 'M'.repeat(200) }],
      toolDeclarations: [],
    };
    const estimated = estimateModelRequestTokens(request);

    expect(
      requestFitsContextWindow({
        ...request,
        contextWindowTokens: estimated,
        reservedOutputTokens: null,
      }),
    ).toBe(true);
    expect(
      requestFitsContextWindow({
        ...request,
        contextWindowTokens: estimated,
        reservedOutputTokens: 1,
      }),
    ).toBe(false);
  });

  it('ignores replayed opaque provider metadata when admitting a request (D15)', () => {
    const reasoning = { type: 'reasoning' as const, text: 'thinking' };
    const metadata = {
      openai: { reasoningEncryptedContent: 'E'.repeat(40_000) },
    };
    const messages = [
      {
        role: 'assistant' as const,
        content: [reasoning, { type: 'text' as const, text: 'answer' }],
      },
    ];
    const withMetadata = [
      {
        role: 'assistant' as const,
        content: [
          { ...reasoning, providerOptions: metadata },
          { type: 'text' as const, text: 'answer' },
        ],
      },
    ];
    const request = { system: 'S'.repeat(400), toolDeclarations: [] };
    const estimated = estimateModelRequestTokens({ ...request, messages });

    // The blob is opaque provider plumbing the admission gate must not size
    // (D15), so a request whose real prompt fits is still admitted.
    expect(
      estimateModelRequestTokens({ ...request, messages: withMetadata }),
    ).toBe(estimated);
    expect(
      requestFitsContextWindow({
        ...request,
        messages: withMetadata,
        contextWindowTokens: estimated,
        reservedOutputTokens: null,
      }),
    ).toBe(true);
  });

  it('divides the whole request projection by four rather than multiplying', () => {
    const estimate = estimateModelRequestTokens({
      system: 's'.repeat(400),
      messages: [{ role: 'user', content: 'u'.repeat(400) }],
      toolDeclarations: [],
    });

    // ~chars/4. A multiply would land four orders of magnitude out.
    expect(estimate).toBeGreaterThan(190);
    expect(estimate).toBeLessThan(600);
  });
});

describe('planCompactionCheckpoint', () => {
  it('absorbs every user/assistant turn between the boundary and the triggering message', () => {
    const first = msg('first question');
    const answer = msg('first answer', 'assistant');
    const followUp = msg('follow-up question');
    const secondAnswer = msg('second answer', 'assistant');
    const triggering = msg('unseen trigger');

    const plan = planCompactionCheckpoint({
      rows: [first, answer, followUp, secondAnswer, triggering],
      boundarySeq: 0,
      triggeringUserSeq: triggering.seq,
    });

    // Nothing is held back: the whole absorbable range is superseded by the
    // checkpoint this attempt publishes before its first model step.
    expect(plan?.uptoSeq).toBe(secondAnswer.seq);
    expect(plan?.absorb.map((message) => message.seq)).toEqual([1, 2, 3, 4]);
  });

  it('never absorbs the triggering message, whatever role shares its sequence', () => {
    const first = { ...msg('first question'), seq: 1 };
    const answer = { ...msg('first answer', 'assistant'), seq: 2 };
    const sameSeqReply = { ...msg('too new', 'assistant'), seq: 3 };
    const triggering = { ...msg('unseen trigger'), seq: 3 };

    const plan = planCompactionCheckpoint({
      rows: [first, answer, sameSeqReply, triggering],
      boundarySeq: 0,
      triggeringUserSeq: 3,
    });

    expect(plan?.uptoSeq).toBe(answer.seq);
    expect(plan?.absorb).not.toContainEqual(sameSeqReply);
    expect(plan?.absorb).not.toContainEqual(triggering);
  });

  it('absorbs a usage-less assistant row, so a forked history can publish too', () => {
    // Forked chats copy assistant rows without usage (chats.service.ts): the
    // cutoff is a sequence range, never a completion test.
    const first = msg('first question');
    const copiedAnswer = msg('copied answer', 'assistant');
    const triggering = msg('unseen trigger');

    const plan = planCompactionCheckpoint({
      rows: [first, copiedAnswer, triggering],
      boundarySeq: 0,
      triggeringUserSeq: triggering.seq,
    });

    expect(plan?.uptoSeq).toBe(copiedAnswer.seq);
    expect(plan?.absorb).toHaveLength(2);
  });

  it('ignores rows at or below the active checkpoint boundary', () => {
    const absorbed = { ...msg('already summarized'), seq: 1 };
    const onBoundary = {
      ...msg('answer at the boundary', 'assistant'),
      seq: 2,
    };
    const answer = { ...msg('answer after the boundary', 'assistant'), seq: 3 };
    const triggering = { ...msg('unseen trigger'), seq: 4 };

    const plan = planCompactionCheckpoint({
      rows: [absorbed, onBoundary, answer, triggering],
      boundarySeq: 2,
      triggeringUserSeq: 4,
    });

    // The active checkpoint already supersedes everything through its own
    // boundary; absorbing those rows again would fold the stored checkpoint
    // into the summary meant to replace it.
    expect(plan?.uptoSeq).toBe(3);
    expect(plan?.absorb.map((message) => message.seq)).toEqual([3]);
  });

  it('publishes nothing when the range holds no user or assistant row', () => {
    // A retry whose checkpoint already landed finds an empty range and must
    // proceed on the checkpoint it has rather than pay a second summary call.
    const triggering = msg('unseen trigger');

    expect(
      planCompactionCheckpoint({
        rows: [
          msg('system only', 'system'),
          msg('tool output', 'tool'),
          triggering,
        ],
        boundarySeq: 0,
        triggeringUserSeq: triggering.seq,
      }),
    ).toBeNull();
    expect(
      planCompactionCheckpoint({
        rows: [{ ...msg('only the trigger'), seq: 1 }],
        boundarySeq: 1,
        triggeringUserSeq: 1,
      }),
    ).toBeNull();
  });

  it('orders an out-of-order window by sequence before choosing the cutoff', () => {
    const later = { ...msg('later answer', 'assistant'), seq: 4 };
    const first = { ...msg('first'), seq: 1 };
    const middle = { ...msg('middle question'), seq: 3 };
    const early = { ...msg('early answer', 'assistant'), seq: 2 };
    const triggering = { ...msg('unseen trigger'), seq: 5 };

    const plan = planCompactionCheckpoint({
      rows: [later, first, triggering, early, middle],
      boundarySeq: 0,
      triggeringUserSeq: 5,
    });

    expect(plan?.uptoSeq).toBe(4);
    expect(plan?.absorb.map((message) => message.seq)).toStrictEqual([
      1, 2, 3, 4,
    ]);
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
    // Independent literal, not `window * COMPACTION_WINDOW_RATIO`: recomputing
    // through the imported constant moves both sides together, so any ratio
    // ships green.
    expect(resolveCompactionThreshold({ contextWindowTokens: 1_000_000 })).toBe(
      800_000,
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
    ).toBe(160_000);
  });
});

describe('countedContextTokens', () => {
  const previousRun = { messageId: 'run-trigger', triggeringUserSeq: 3 };

  it('counts the reply the previous completed run produced for a turn above the boundary', () => {
    const reply = row(4, 'assistant', {
      inReplyTo: 'run-trigger',
      usage: { contextTokens: 4321 },
    });

    expect(
      countedContextTokens({
        previousCompleted: previousRun,
        rows: [row(1, 'user'), reply],
        boundarySeq: 1,
      }),
    ).toEqual({ replySeq: 4, contextTokens: 4321 });
  });

  it('judges by the turn the reply answers, not by the reply own sequence', () => {
    // A retried assistant row is rewritten in place, so its sequence can sit
    // below a checkpoint published between its attempts while the turn it
    // answers is still above the boundary.
    const rewritten = row(2, 'assistant', {
      inReplyTo: 'run-trigger',
      usage: { contextTokens: 900 },
    });

    expect(
      countedContextTokens({
        previousCompleted: { messageId: 'run-trigger', triggeringUserSeq: 4 },
        rows: [rewritten],
        boundarySeq: 3,
      }),
    ).toEqual({ replySeq: 2, contextTokens: 900 });
  });

  it('yields no measurement for a turn the active checkpoint already covers', () => {
    const reply = row(2, 'assistant', {
      inReplyTo: 'run-trigger',
      usage: { contextTokens: 900 },
    });

    expect(
      countedContextTokens({
        previousCompleted: previousRun,
        rows: [reply],
        boundarySeq: 3,
      }),
    ).toBeUndefined();
    expect(
      countedContextTokens({
        previousCompleted: { messageId: 'run-trigger', triggeringUserSeq: 2 },
        rows: [reply],
        boundarySeq: 3,
      }),
    ).toBeUndefined();
  });

  it('requires the matching reply row to be an assistant message', () => {
    const userRow = row(4, 'user', {
      inReplyTo: 'run-trigger',
      usage: { contextTokens: 900 },
    });

    expect(
      countedContextTokens({
        previousCompleted: previousRun,
        rows: [userRow],
        boundarySeq: 1,
      }),
    ).toBeUndefined();
  });

  it('accepts a zero-sized persisted context measurement', () => {
    const reply = row(4, 'assistant', {
      inReplyTo: 'run-trigger',
      usage: { contextTokens: 0 },
    });

    expect(
      countedContextTokens({
        previousCompleted: previousRun,
        rows: [reply],
        boundarySeq: 1,
      }),
    ).toEqual({ replySeq: 4, contextTokens: 0 });
  });

  it('yields no measurement without a previous completed run or its reply', () => {
    const reply = row(4, 'assistant', {
      inReplyTo: 'run-trigger',
      usage: { contextTokens: 4321 },
    });

    expect(
      countedContextTokens({
        previousCompleted: undefined,
        rows: [reply],
        boundarySeq: 1,
      }),
    ).toBeUndefined();
    // Another turn's reply is not this run's measurement.
    expect(
      countedContextTokens({
        previousCompleted: previousRun,
        rows: [{ ...reply, inReplyTo: 'other-trigger' }],
        boundarySeq: 1,
      }),
    ).toBeUndefined();
  });

  it('yields no measurement once a delete nulled the triggering message', () => {
    expect(
      countedContextTokens({
        previousCompleted: { messageId: null, triggeringUserSeq: 3 },
        rows: [row(4, 'assistant', { usage: { contextTokens: 4321 } })],
        boundarySeq: 1,
      }),
    ).toBeUndefined();
  });

  it.each([
    ['no usage at all', null],
    ['a usage blob without a context size', { status: 'completed' }],
    ['a non-numeric context size', { contextTokens: '4321' }],
    ['a negative context size', { contextTokens: -1 }],
    ['a non-finite context size', { contextTokens: Number.NaN }],
    ['a non-object usage value', 'completed'],
  ])('yields no measurement for %s', (_label, usage) => {
    expect(
      countedContextTokens({
        previousCompleted: previousRun,
        rows: [row(4, 'assistant', { inReplyTo: 'run-trigger', usage })],
        boundarySeq: 1,
      }),
    ).toBeUndefined();
  });
});

describe('estimateContinuationTokens', () => {
  it('grows with the rows a prepared request adds after the counted reply', () => {
    const one = estimateContinuationTokens({
      rows: [msg('a question')],
      railText: '',
    });
    const three = estimateContinuationTokens({
      rows: [
        msg('a question'),
        msg('an answer', 'assistant'),
        msg('another question'),
      ],
      railText: '',
    });

    expect(three).toBeGreaterThan(one);
  });

  it('grows with the staged rail text the stored rows do not carry', () => {
    expect(
      estimateContinuationTokens({ rows: [], railText: 'R'.repeat(400) }),
    ).toBeGreaterThan(estimateContinuationTokens({ rows: [], railText: '' }));
  });
  it('adds exactly one token for each four staged rail characters', () => {
    const base = estimateContinuationTokens({ rows: [], railText: '' });

    expect(
      estimateContinuationTokens({
        rows: [],
        railText: 'R'.repeat(400),
      }) - base,
    ).toBe(100);
  });

  it('does not add a system prompt to a continuation estimate', () => {
    // An empty projection serializes to 38 chars, so ceil(38 / 4) is 10.
    expect(estimateContinuationTokens({ rows: [], railText: '' })).toBe(10);
  });

  it('counts replayed reasoning text but not the provider own metadata blob (D15/D16)', () => {
    const question = msg('question');
    const answer = msg('answer', 'assistant');
    const estimateWith = (parts: StoredMessage['parts']): number =>
      estimateContinuationTokens({
        rows: [question, { ...answer, parts }],
        railText: '',
      });

    const plain = estimateWith([
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'answer' },
    ]);
    const withMetadata = estimateWith([
      {
        type: 'reasoning',
        text: 'thinking',
        providerMetadata: {
          openai: { reasoningEncryptedContent: 'E'.repeat(40_000) },
        },
      },
      { type: 'text', text: 'answer' },
    ]);
    const withMoreReasoning = estimateWith([
      { type: 'reasoning', text: 'thinking '.repeat(1000) },
      { type: 'text', text: 'answer' },
    ]);

    // The continuation re-reads the reasoning text …
    expect(withMoreReasoning).toBeGreaterThan(plain);
    // … while the provider opaque metadata must not size it.
    expect(withMetadata).toBe(plain);
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
      variant: 'threshold',
    });

    // Cache alignment: the system prompt is the chat's own, verbatim — a swapped
    // summarizer prompt would invalidate the whole provider prompt-cache prefix.
    expect(request.system).toBe(CHAT_SYSTEM);
    expect(request.messages[0].role).toBe('user');
    expect(contentText(request.messages[0].content)).toContain(
      'plan a trip to Japan',
    );
    expect(request.messages[1].role).toBe('assistant');
    const last = request.messages.at(-1);
    expect(last).toEqual({ role: 'user', content: COMPACTION_INSTRUCTION });
  });

  it('pins the compaction ratio itself', () => {
    expect(COMPACTION_WINDOW_RATIO).toBe(0.8);
  });

  it('summarizes a history that stores reasoning without replaying it', () => {
    const question = msg('plan a trip to Japan');
    const answer = msg('sure — when?', 'assistant');
    answer.parts = [
      { type: 'reasoning', text: 'SECRET_REASONING' },
      { type: 'text', text: 'VISIBLE_ANSWER' },
    ];

    const request = buildCompactionRequest({
      system: CHAT_SYSTEM,
      previous: undefined,
      absorb: [question, answer],
      variant: 'threshold',
    });

    const serialized = JSON.stringify(request.messages);
    // Reasoning is excluded from what the summarizer reads …
    expect(serialized).not.toContain('SECRET_REASONING');
    // … while the visible turn still reaches it.
    expect(serialized).toContain('VISIBLE_ANSWER');
  });

  it.each([
    ['COMPACTION_INSTRUCTION', COMPACTION_INSTRUCTION],
    ['TRANSITION_COMPACTION_INSTRUCTION', TRANSITION_COMPACTION_INSTRUCTION],
  ])(
    '%s requests the stable operational-handoff Markdown sections, in order',
    (_label, instruction) => {
      // Authored independently of the instruction templates (#57's acceptance
      // criteria). Reading the headings out of a template would let a dropped
      // section still pass. Asserted as one contiguous block, and against BOTH
      // instructions: each template now carries its own copy of the heading
      // list, so a per-heading presence check on one instruction would let the
      // other's membership or order drift while both promise "in this order".
      const EXPECTED_HEADINGS = [
        'Objective',
        'Constraints and Preferences',
        'Decisions and Rationale',
        'Established Facts',
        'Current State',
        'Open Questions and Next Steps',
        'Critical References',
      ];
      expect(instruction).toContain(
        EXPECTED_HEADINGS.map((heading) => `## ${heading}`).join('\n'),
      );
      expect(instruction).toContain('Output only the summary');
    },
  );

  it('gives the compaction model semantically relevant availability history to preserve', () => {
    const affectedTurn = msg('Use the docs lookup once it recovers.');
    affectedTurn.parts = [
      createToolAvailabilityItem({
        runId: '11111111-1111-4111-8111-111111111111',
        payload: {
          kind: 'delta',
          added: [],
          removed: [],
          unavailable: [],
          becameUnavailable: [
            { id: 'mcp__docs__lookup', reason: 'source_disconnected' },
          ],
          nowAvailable: [],
        },
      }),
      { type: 'text', text: 'Use the docs lookup once it recovers.' },
    ];

    const request = buildCompactionRequest({
      system: CHAT_SYSTEM,
      previous: undefined,
      absorb: [affectedTurn],
      variant: 'threshold',
    });
    const rendered = request.messages
      .map(({ content }) => contentText(content))
      .join('\n');

    // The availability item reaches the summarizer through the shared
    // envelope; the retired per-producer delimiter no longer exists.
    expect(rendered).toContain('producer="tool-availability"');
    expect(rendered).toContain('mcp__docs__lookup');
    expect(rendered).toContain('server disconnected');
    expect(request.messages.at(-1)).toEqual({
      role: 'user',
      content: COMPACTION_INSTRUCTION,
    });
  });

  it('uses the dedicated window-trigger contract without inventing a next step for an unseen trigger', () => {
    const request = buildCompactionRequest({
      system: CHAT_SYSTEM,
      previous: undefined,
      absorb: [msg('unfinished work'), msg('current state', 'assistant')],
      variant: 'window',
    });

    expect(request.messages.at(-1)).toEqual({
      role: 'user',
      content: TRANSITION_COMPACTION_INSTRUCTION,
    });
    expect(TRANSITION_COMPACTION_INSTRUCTION).toContain(
      'A newer user message follows this summarized prefix',
    );
    expect(TRANSITION_COMPACTION_INSTRUCTION).toContain(
      'Do not invent a next step',
    );
    expect(TRANSITION_COMPACTION_INSTRUCTION).toContain(
      'current unresolved state',
    );
    expect(TRANSITION_COMPACTION_INSTRUCTION).toContain(
      'exact critical references',
    );
    expect(TRANSITION_COMPACTION_INSTRUCTION).toContain('<user_chat_history>');
  });

  it('excludes both standing-context delimiters from a persisted checkpoint', () => {
    expect(COMPACTION_INSTRUCTION).toContain('<user_personalization>');
    expect(COMPACTION_INSTRUCTION).toContain('<user_chat_history>');
    expect(TRANSITION_COMPACTION_INSTRUCTION).toContain(
      '<user_personalization>',
    );
    expect(TRANSITION_COMPACTION_INSTRUCTION).toContain('<user_chat_history>');
  });

  it('replays the previous stored checkpoint exactly before absorbed turns', () => {
    const persistedCheckpoint =
      '<system-reminder producer="compaction" form="checkpoint">stored checkpoint</system-reminder>';
    const request = buildCompactionRequest({
      system: CHAT_SYSTEM,
      previous: {
        text: persistedCheckpoint,
        absorbedThroughSeq: 0,
      },
      absorb: [msg('actually make it $4000')],
      variant: 'threshold',
    });

    expect(request.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: persistedCheckpoint }],
    });
    const rendered = request.messages
      .map((m) => contentText(m.content))
      .join('\n');
    expect(rendered.indexOf('stored checkpoint')).toBeLessThan(
      rendered.indexOf('$4000'),
    );
  });

  it('never trims absorbed turns — every absorbed message reaches the summarizer', () => {
    const absorb = Array.from({ length: 150 }, (_, i) => msg(`turn ${i}`));

    const request = buildCompactionRequest({
      system: CHAT_SYSTEM,
      previous: undefined,
      absorb,
      variant: 'threshold',
    });

    // 150 absorbed turns + trailing instruction — nothing dropped.
    expect(request.messages).toHaveLength(151);
    expect(contentText(request.messages[0].content)).toContain('turn 0');
  });

  it('skips persisted system and tool rows like portable live replay does', () => {
    const request = buildCompactionRequest({
      system: CHAT_SYSTEM,
      previous: undefined,
      absorb: [
        msg('system-only directive', 'system'),
        msg('tool output payload', 'tool'),
        msg('assistant answer', 'assistant'),
      ],
      variant: 'threshold',
    });

    expect(request.messages).toEqual([
      { role: 'assistant', content: 'assistant answer' },
      { role: 'user', content: COMPACTION_INSTRUCTION },
    ]);
  });
});

describe('normalizeCompactionSummary', () => {
  it.each([undefined, null, 42, '', '   \n\t'])(
    'rejects a non-text or empty summary fixture: %p',
    (value) => {
      expect(normalizeCompactionSummary(value)).toBeNull();
    },
  );

  it('returns trimmed non-empty text without rewriting its Markdown structure', () => {
    const fixture = '  ## Objective\nContinue the migration.\n  ';
    expect(normalizeCompactionSummary(fixture)).toBe(
      '## Objective\nContinue the migration.',
    );
  });
});

describe('personalization exclusion (add-user-personalization D7)', () => {
  // BOTH constants, not just the full-current one: they share the section
  // headings and both ask for constraints and preferences, so fixing one would
  // leave the transition path leaking a standing profile into a checkpoint.
  it.each([
    ['COMPACTION_INSTRUCTION', COMPACTION_INSTRUCTION],
    ['TRANSITION_COMPACTION_INSTRUCTION', TRANSITION_COMPACTION_INSTRUCTION],
  ])('%s excludes the personalization block by name', (_label, instruction) => {
    expect(instruction).toContain('<user_personalization>');
    expect(instruction).toMatch(/do not carry any content out of/i);
    // Says WHY, so the reason survives a later paraphrase of the wording.
    expect(instruction).toMatch(/re-supplied on every request/i);
  });

  // Pinned independently, as literal text, because this sentence is the
  // instruction's only defense against personalization leaking into a persisted
  // checkpoint; the assertions above match fragments and would survive a
  // rewritten clause.
  const STANDING_CONTEXT_EXCLUSION_SENTENCE =
    'Do not carry any content out of the <user_personalization> or <user_chat_history> blocks into the summary, and do not carry any content out of a <system-reminder> block whose producer attribute is "recency-digest". Do not carry the system-supplied temporal context line (the line stating context as of a date) into the summary either. These describe standing context rather than this conversation, are re-supplied on every request, and must not be frozen into this checkpoint. Dates, deadlines, or intervals the user or assistant established within the conversation itself still belong in the summary.';

  it.each([
    ['COMPACTION_INSTRUCTION', COMPACTION_INSTRUCTION],
    ['TRANSITION_COMPACTION_INSTRUCTION', TRANSITION_COMPACTION_INSTRUCTION],
  ])(
    '%s carries the standing-context exclusion sentence verbatim',
    (_label, instruction) => {
      expect(instruction).toContain(STANDING_CONTEXT_EXCLUSION_SENTENCE);
    },
  );

  it.each([
    ['COMPACTION_INSTRUCTION', COMPACTION_INSTRUCTION],
    ['TRANSITION_COMPACTION_INSTRUCTION', TRANSITION_COMPACTION_INSTRUCTION],
  ])(
    '%s still keeps in-conversation constraints in scope',
    (_label, instruction) => {
      // The exclusion is about provenance, not the section: dates and
      // constraints the user actually stated in the conversation must still be
      // summarized. Assert the EXCLUSION's own carve-out clause.
      expect(instruction).toMatch(
        /the user or assistant established within the conversation/i,
      );
    },
  );

  it('leaves the cached prefix untouched — the exclusion rides in the trailing message only', () => {
    const system =
      'SYSTEM PROMPT <user_personalization>Leo</user_personalization>';
    const request = buildCompactionRequest({
      system,
      previous: undefined,
      absorb: [msg('hello'), msg('hi', 'assistant')],
      variant: 'threshold',
    });

    // The replayed system prompt is byte-identical to what the turn bound.
    // Editing it instead would change the prefix and make the whole call cold,
    // which is exactly the alternative D7 rejects.
    expect(request.system).toBe(system);

    // And the instruction lands as the FINAL message, after the absorbed
    // history — outside the prefix the provider matches on.
    const last = request.messages.at(-1);
    expect(last?.role).toBe('user');
    expect(JSON.stringify(last)).toContain('<user_personalization>');
  });
});

describe('isPositiveFinite', () => {
  it.each([
    [undefined, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    [-1, false],
    [0, false],
    [0.5, true],
    [1, true],
  ] as const)('classifies %p as %p', (value, expected) => {
    expect(isPositiveFinite(value)).toBe(expected);
  });
});
