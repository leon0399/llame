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
  COMPACTION_SECTION_HEADINGS,
  COMPACTION_WINDOW_RATIO,
  TRANSITION_COMPACTION_INSTRUCTION,
  buildCompactionRequest,
  buildNextCompactionToolObservationLedger,
  estimateModelRequestTokens,
  estimateContextTokens,
  planTransitionCompaction,
  requestFitsContextWindow,
  normalizeCompactionSummary,
  planCompaction,
  resolveCompactionThreshold,
} from './compaction';
import {
  buildContext,
  renderConversationCheckpoint,
} from '../chats/context-builder';
import {
  TOOL_REPLAY_CALL_LIMIT,
  TOOL_REPLAY_TURN_LIMIT,
} from '../chats/tool-observation-part';
import type { StoredMessage } from '../chats/context-builder';
import { isRecord, isString } from '../unknown-record';

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

  it('counts the serialized structured projection for tool-heavy history', () => {
    const assistant = msg('', 'assistant');
    assistant.parts = Array.from({ length: 40 }, (_, index) => ({
      type: 'tool-search_conversations',
      toolCallId: `tool-heavy-${index}`,
      state: 'output-available',
      input: { query: `query-${index}` },
      output: { status: 'success', value: 'R'.repeat(100) },
      outcome: 'success',
    }));
    const recent = msg('recent');

    expect(
      estimateContextTokens([assistant, recent], undefined),
    ).toBeGreaterThan(1_000);
    expect(
      planCompaction({
        history: [assistant, recent],
        previousSummary: undefined,
        thresholdTokens: 1_000,
        keepRecentMessages: 1,
      }),
    ).not.toBeNull();
  });

  it('counts the compacted structured ledger in the fallback estimate', () => {
    const ledger = {
      version: 1 as const,
      omittedCount: 0,
      observations: Array.from({ length: 40 }, (_, index) => ({
        toolCallId: `ledger-${index}`,
        toolName: 'search_conversations',
        outcome: 'success',
      })),
    };

    expect(estimateContextTokens([], 'summary', ledger)).toBeGreaterThan(
      estimateContextTokens([], 'summary'),
    );
  });
});

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
});

describe('planTransitionCompaction', () => {
  it('cuts through the last completed assistant and excludes the triggering user message', () => {
    const firstUser = msg('first');
    const completedAssistant = {
      ...msg('answer', 'assistant'),
      usage: { status: 'completed' },
    };
    const failedAssistant = {
      ...msg('partial', 'assistant'),
      usage: { status: 'error' },
    };
    const triggering = msg('unseen trigger');

    const plan = planTransitionCompaction(
      [firstUser, completedAssistant, failedAssistant, triggering],
      triggering.seq,
    );

    expect(plan?.uptoSeq).toBe(completedAssistant.seq);
    expect(plan?.absorb.map((message) => message.seq)).toEqual([
      firstUser.seq,
      completedAssistant.seq,
    ]);
    expect(plan?.absorb).not.toContainEqual(triggering);
  });

  it('treats a usage-less assistant turn (fork/legacy copy) as a valid cutoff', () => {
    // Forked chats copy assistant messages without usage (chats.service.ts) and
    // isCompletedAssistantTurn counts null/malformed usage as completed — the
    // transition planner must not disagree, or forks could never transition.
    const firstUser = msg('first');
    const forkedAssistant = msg('copied answer', 'assistant'); // no usage
    const triggering = msg('unseen trigger');

    const plan = planTransitionCompaction(
      [firstUser, forkedAssistant, triggering],
      triggering.seq,
    );

    expect(plan?.uptoSeq).toBe(forkedAssistant.seq);
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
    expect(request.messages[0].role).toBe('user');
    expect(contentText(request.messages[0].content)).toContain(
      'plan a trip to Japan',
    );
    expect(request.messages[1].role).toBe('assistant');
    const last = request.messages[request.messages.length - 1];
    expect(last).toEqual({ role: 'user', content: COMPACTION_INSTRUCTION });
  });

  it('requests the stable operational-handoff Markdown sections', () => {
    for (const heading of COMPACTION_SECTION_HEADINGS) {
      expect(COMPACTION_INSTRUCTION).toContain(`## ${heading}`);
    }
    expect(COMPACTION_INSTRUCTION).toContain('Output only the summary');
  });

  it('gives the compaction model semantically relevant availability history to preserve', () => {
    const affectedTurn = msg('Use the docs lookup once it recovers.');
    affectedTurn.parts = [
      {
        type: 'data-context',
        data: {
          v: 1,
          producer: 'tool-availability',
          form: 'notice',
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
        },
      },
      { type: 'text', text: 'Use the docs lookup once it recovers.' },
    ];

    const request = buildCompactionRequest({
      system: CHAT_SYSTEM,
      previous: undefined,
      absorb: [affectedTurn],
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

  it('uses the dedicated transition-up-to contract without inventing a next step for an unseen trigger', () => {
    const request = buildCompactionRequest({
      system: CHAT_SYSTEM,
      previous: undefined,
      absorb: [msg('unfinished work'), msg('current state', 'assistant')],
      mode: 'transition_up_to',
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
      content: renderConversationCheckpoint(
        'User is planning a trip; budget $3000.',
      ),
    });
    const rendered = request.messages
      .map((m) => contentText(m.content))
      .join('\n');
    expect(rendered.indexOf('budget $3000')).toBeLessThan(
      rendered.indexOf('$4000'),
    );
  });

  it('keeps the previous checkpoint and ledger cache-aligned before absorbed turns', () => {
    const request = buildCompactionRequest({
      system: CHAT_SYSTEM,
      previous: {
        summary: 'Earlier summary.',
        uptoSeq: 10,
        toolObservationLedger: {
          version: 1,
          omittedCount: 2,
          observations: [
            {
              toolCallId: 'previous-ledger-call',
              toolName: 'search_conversations',
              outcome: 'invalid_input',
            },
          ],
        },
      },
      absorb: [{ ...msg('new delta'), seq: 11 }],
    });

    expect(request.messages.map(({ role }) => role).slice(0, 5)).toEqual([
      'user',
      'assistant',
      'assistant',
      'tool',
      'user',
    ]);
    expect(JSON.stringify(request.messages[0])).toContain('Earlier summary.');
    expect(JSON.stringify(request.messages[1])).toContain(
      '2 earlier tool observations omitted',
    );
    expect(JSON.stringify(request.messages[2])).toContain(
      'previous-ledger-call',
    );
    expect(JSON.stringify(request.messages[3])).toContain(
      'Outcome: invalid_input',
    );
    expect(JSON.stringify(request.messages[4])).toContain('new delta');
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
    });

    expect(request.messages).toEqual([
      { role: 'assistant', content: 'assistant answer' },
      { role: 'user', content: COMPACTION_INSTRUCTION },
    ]);
  });
});

describe('compacted tool-observation ledger', () => {
  it('accepts current Knowledge passage/range results and historical hash-bearing results', () => {
    const assistant = msg('', 'assistant');
    assistant.parts = [
      {
        type: 'tool-knowledge_search',
        toolCallId: 'knowledge-search-current',
        state: 'output-available',
        input: {},
        output: {
          status: 'success',
          results: [
            {
              offset: 4,
              limit: 3,
              excerpt: 'checkpoint',
            },
          ],
          complete: true,
        },
        outcome: 'success',
      },
      {
        type: 'tool-knowledge_read',
        toolCallId: 'knowledge-read-current',
        state: 'output-available',
        input: {},
        output: {
          status: 'success',
          offset: 4,
          lineCount: 3,
          content: '5: before\n6: checkpoint\n7: after',
        },
        outcome: 'success',
      },
      {
        type: 'tool-knowledge_search',
        toolCallId: 'knowledge-search-historical',
        state: 'output-available',
        input: {},
        output: {
          status: 'success',
          results: [
            {
              line: 6,
              snippet: 'checkpoint',
              contentHash: 'historical-search-hash',
            },
          ],
        },
        outcome: 'success',
      },
      {
        type: 'tool-knowledge_read',
        toolCallId: 'knowledge-read-historical',
        state: 'output-available',
        input: {},
        output: {
          status: 'success',
          content: 'checkpoint',
          contentHash: 'historical-read-hash',
        },
        outcome: 'success',
      },
    ];

    const ledger = buildNextCompactionToolObservationLedger({
      previous: undefined,
      absorb: [assistant],
    });

    expect(
      ledger.observations.map(
        ({ toolCallId, toolName, outcome }) =>
          `${toolCallId}:${toolName}:${outcome}`,
      ),
    ).toEqual([
      'knowledge-search-current:knowledge_search:success',
      'knowledge-read-current:knowledge_read:success',
      'knowledge-search-historical:knowledge_search:success',
      'knowledge-read-historical:knowledge_read:success',
    ]);

    const replay = buildContext([], {
      systemPrompt: 'system',
      compaction: {
        summary: 'Checkpoint',
        uptoSeq: assistant.seq,
        toolObservationLedger: ledger,
      },
    }).messages;
    const serialized = JSON.stringify(replay);
    for (const callId of [
      'knowledge-search-current',
      'knowledge-read-current',
      'knowledge-search-historical',
      'knowledge-read-historical',
    ]) {
      expect(serialized).toContain(callId);
    }
    expect(serialized).not.toContain('historical-search-hash');
    expect(serialized).not.toContain('historical-read-hash');
  });

  it('stores and replays an incomplete outcome after clearing a degraded Knowledge search', () => {
    const assistant = msg('', 'assistant');
    assistant.parts = [
      {
        type: 'tool-knowledge_search',
        toolCallId: 'knowledge-incomplete-ledger',
        state: 'output-available',
        input: { query: 'checkpoint' },
        output: {
          status: 'success',
          complete: false,
          results: [{ path: 'notes/checkpoint.md' }],
          warnings: [],
          warningCount: 1,
        },
        outcome: 'success',
      },
    ];

    const ledger = buildNextCompactionToolObservationLedger({
      previous: undefined,
      absorb: [assistant],
    });

    expect(ledger.observations).toEqual([
      {
        toolCallId: 'knowledge-incomplete-ledger',
        toolName: 'knowledge_search',
        outcome: 'incomplete',
      },
    ]);
    const replay = buildContext([], {
      systemPrompt: 'system',
      compaction: {
        summary: 'Checkpoint',
        uptoSeq: assistant.seq,
        toolObservationLedger: ledger,
      },
    }).messages;
    expect(JSON.stringify(replay)).toContain('Outcome: incomplete');
    expect(JSON.stringify(replay)).not.toContain('"complete":false');
  });

  it('resets a hostile previous ledger before writing with no absorbed observations', () => {
    const ledger = buildNextCompactionToolObservationLedger({
      previous: {
        version: 1,
        omittedCount: -1,
        observations: [],
      },
      absorb: [],
    });

    expect(ledger).toEqual({ version: 1, omittedCount: 0, observations: [] });
  });

  it('keeps the omission count a safe integer when an already-maximal ledger drops another pair', () => {
    const assistant = msg('', 'assistant');
    assistant.parts = [
      {
        type: 'tool-search_conversations',
        toolCallId: 'x'.repeat(TOOL_REPLAY_CALL_LIMIT * 2),
        state: 'output-error',
        input: {},
        errorText: 'x',
        outcome: 'invalid_input',
      },
    ];

    const ledger = buildNextCompactionToolObservationLedger({
      previous: {
        version: 1,
        omittedCount: Number.MAX_SAFE_INTEGER,
        observations: [],
      },
      absorb: [assistant],
    });

    expect(ledger.omittedCount).toBe(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(ledger.omittedCount)).toBe(true);
    expect(ledger.observations).toEqual([]);
  });

  it('bounds a cleared ledger by dropping oldest complete pairs and carrying one omission count', () => {
    const assistant = msg('', 'assistant');
    assistant.parts = Array.from({ length: 220 }, (_, index) => ({
      type: 'tool-search_conversations',
      toolCallId: `ledger-many-${index.toString().padStart(3, '0')}`,
      state: 'output-error',
      input: {},
      errorText: 'x',
      outcome: 'invalid_input',
    }));

    const ledger = buildNextCompactionToolObservationLedger({
      previous: undefined,
      absorb: [assistant],
    });
    const replay = buildContext([], {
      systemPrompt: 'system',
      compaction: {
        summary: '',
        uptoSeq: assistant.seq,
        toolObservationLedger: ledger,
      },
    }).messages.slice(1);
    const serialized = JSON.stringify(replay);

    expect(serialized.length).toBeLessThanOrEqual(TOOL_REPLAY_TURN_LIMIT);
    expect(ledger.omittedCount).toBeGreaterThan(0);
    expect(serialized).not.toContain('ledger-many-000');
    expect(serialized).toContain('ledger-many-219');
    expect(serialized.match(/tool observations omitted/g)).toHaveLength(1);
    expect(serialized.match(/"type":"tool-call"/g)).toHaveLength(
      [...serialized.matchAll(/"type":"tool-result"/g)].length,
    );
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
      mode: 'full_current',
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
