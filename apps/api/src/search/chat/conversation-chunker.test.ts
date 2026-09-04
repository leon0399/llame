import {
  CHUNK_ANCHOR_MAX_CHARS,
  CHUNK_MAX_CHARS,
  chunkConversation,
  type ChunkerMessage,
} from './conversation-chunker';

const at = (n: number) => new Date(2026, 0, 1, 0, 0, n);
const text = (t: string) => [{ type: 'text', text: t }];

function userMsg(id: string, t: string, n: number): ChunkerMessage {
  return { id, role: 'user', parts: text(t), createdAt: at(n) };
}
function assistantMsg(id: string, t: string, n: number): ChunkerMessage {
  return { id, role: 'assistant', parts: text(t), createdAt: at(n) };
}

describe('chunkConversation', () => {
  it('derives message text from visible text parts with exact double-newline joins and no trim', () => {
    const chunks = chunkConversation([
      {
        id: 'm1',
        role: 'user',
        parts: [
          { type: 'text', text: '  alpha\n' },
          { type: 'reasoning', text: 'hidden' },
          { type: 'text', text: '\n beta \t' },
        ],
        createdAt: at(0),
      },
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      content: '[user]   alpha\n\n\n\n beta \t',
      normalizedContent: 'alpha beta',
      firstMessageTextOffset: 0,
      lastMessageTextOffsetExclusive: '  alpha\n\n\n\n beta \t'.length,
    });
  });

  it('serializes user/assistant text with role markers into one chunk', () => {
    const chunks = chunkConversation([
      userMsg('m1', 'How does search work?', 0),
      assistantMsg('m2', 'Full-text plus trigram.', 1),
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(
      '[user] How does search work?\n\n[assistant] Full-text plus trigram.',
    );
    expect(chunks[0].normalizedContent).toBe(
      'how does search work? full-text plus trigram.',
    );
    expect(chunks[0].normalizedContent).not.toContain('user');
    expect(chunks[0].normalizedContent).not.toContain('assistant');
    expect(chunks[0].firstMessageId).toBe('m1');
    expect(chunks[0].lastMessageId).toBe('m2');
    expect(chunks[0]).toMatchObject({
      firstMessageTextOffset: 0,
      lastMessageTextOffsetExclusive: 'Full-text plus trigram.'.length,
    });
    expect(chunks[0].chunkOrdinal).toBe(0);
  });

  it('excludes system/tool roles and non-text parts entirely', () => {
    const chunks = chunkConversation([
      {
        id: 's',
        role: 'system',
        parts: text('SECRET PROMPT'),
        createdAt: at(0),
      },
      {
        id: 't',
        role: 'tool',
        parts: text('tool result CROSS-TENANT'),
        createdAt: at(1),
      },
      {
        id: 'a',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'hidden chain of thought' },
          { type: 'tool-search', output: 'other chat snippet' },
          { type: 'text', text: 'visible answer' },
        ],
        createdAt: at(2),
      },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('[assistant] visible answer');
    expect(chunks[0].normalizedContent).not.toContain('secret');
    expect(chunks[0].normalizedContent).not.toContain('cross-tenant');
    expect(chunks[0].normalizedContent).not.toContain('hidden');
    expect(chunks[0].normalizedContent).not.toContain('snippet');
  });

  it('indexes only canonical human text when a user row carries trusted control parts', () => {
    const chunks = chunkConversation([
      {
        id: 'u-control',
        role: 'user',
        parts: [
          {
            type: 'data-context',
            data: {
              v: 1,
              producer: 'effective-context-change',
              form: 'notice',
              payload: { cause: 'model' },
              fromModelId: 'zzprevmodelquartz',
              toModelId: 'zzcurrentmodelvelvet',
              runId: '11111111-1111-4111-8111-111111111111',
              generatedReminderFixture: 'zzreminderprosecobalt',
            },
          },
          {
            type: 'data-context',
            data: {
              v: 1,
              producer: 'tool-availability',
              form: 'notice',
              kind: 'delta',
              runId: '22222222-2222-4222-8222-222222222222',
              added: [],
              removed: ['zzremovedtoolscarlet'],
              unavailable: [
                {
                  id: 'zzunavailabletoolazure',
                  reason: 'source_disconnected',
                },
              ],
              becameUnavailable: [],
              nowAvailable: [],
              generatedReminderFixture: 'zzavailabilityreminderbronze',
            },
          },
          {
            type: 'conversation-checkpoint',
            summary: 'zzcheckpointindigo',
          },
          {
            type: 'effective-context-receipt',
            systemPrompt: 'zzsystempromptamber',
            inputSchema: 'zztoolschemamercury',
          },
          { type: 'text', text: 'zzhumanoriginalgreen' },
        ],
        createdAt: at(0),
      },
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('[user] zzhumanoriginalgreen');
    expect(JSON.stringify(chunks)).not.toMatch(
      /zz(prevmodel|currentmodel|reminderprose|removedtool|unavailabletool|availabilityreminder|checkpoint|systemprompt|toolschema)/,
    );
  });

  it('skips messages whose text parts are empty (all reasoning/tool)', () => {
    const chunks = chunkConversation([
      {
        id: 'r',
        role: 'assistant',
        parts: [{ type: 'reasoning', text: 'thinking' }],
        createdAt: at(0),
      },
      userMsg('u', 'real question', 1),
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].firstMessageId).toBe('u');
  });

  it('excludes retryable assistant rows from the projection input', () => {
    const chunks = chunkConversation([
      userMsg('u', 'stable prompt', 0),
      {
        id: 'a',
        role: 'assistant',
        parts: text('unstable answer'),
        usage: { status: 'error' },
        createdAt: at(1),
      },
    ]);
    expect(chunks).toEqual([
      expect.objectContaining({
        firstMessageId: 'u',
        lastMessageId: 'u',
        content: '[user] stable prompt',
        normalizedContent: 'stable prompt',
      }),
    ]);
  });

  it('is deterministic (identical input → byte-identical chunks + hashes)', () => {
    const convo = [userMsg('m1', 'alpha', 0), assistantMsg('m2', 'beta', 1)];
    expect(chunkConversation(convo)).toEqual(chunkConversation(convo));
  });

  it('splits across chunks on the char budget with 1-message overlap', () => {
    const big = 'x'.repeat(CHUNK_MAX_CHARS - '[assistant] '.length);
    const chunks = chunkConversation([
      userMsg('m1', big, 0),
      assistantMsg('m2', big, 1),
      userMsg('m3', big, 2),
    ]);
    expect(chunks.length).toBeGreaterThan(1);
    // Overlap: chunk N's last message is chunk N+1's first.
    expect(chunks[0].lastMessageId).toBe(chunks[1].firstMessageId);
    expect(chunks[1]).toMatchObject({
      firstMessageTextOffset: 0,
      lastMessageTextOffsetExclusive: big.length,
    });
  });

  it('uses the first and last block endpoints for an overlapped multi-message chunk', () => {
    const firstText = 'u'.repeat(CHUNK_MAX_CHARS - '[user] '.length - 10);
    const lastText = 'answer';
    const chunks = chunkConversation([
      userMsg('u1', firstText, 0),
      assistantMsg('a1', lastText, 1),
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      firstMessageId: 'u1',
      lastMessageId: 'u1',
      firstMessageTextOffset: 0,
      lastMessageTextOffsetExclusive: firstText.length,
    });
    expect(chunks[1]).toMatchObject({
      firstMessageId: 'u1',
      lastMessageId: 'a1',
      firstMessageTextOffset: 0,
      lastMessageTextOffsetExclusive: lastText.length,
    });
    // The first message is presentation overlap, not a source gap: the second
    // chunk's locator still starts at the first block's source offset and ends
    // at the final block's source endpoint.
    expect(chunks[1].content.length).toBeGreaterThan(CHUNK_MAX_CHARS);
  });

  it('normalizes non-ASCII case (Cyrillic) while preserving accents', () => {
    const chunks = chunkConversation([userMsg('m1', 'ПРИВЕТ Café', 0)]);
    expect(chunks[0].normalizedContent).toContain('привет café');
  });

  it('returns no chunks for a system/tool-only chat', () => {
    expect(
      chunkConversation([
        { id: 's', role: 'system', parts: text('sys'), createdAt: at(0) },
      ]),
    ).toEqual([]);
  });

  it('keeps a message whose role prefix exactly fills the chunk budget in one block', () => {
    const content = 'x'.repeat(CHUNK_MAX_CHARS - '[user] '.length);
    const chunks = chunkConversation([userMsg('exact', content, 0)]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      content: `[user] ${content}`,
      firstMessageTextOffset: 0,
      lastMessageTextOffsetExclusive: content.length,
    });
    expect(chunks[0].content).toHaveLength(CHUNK_MAX_CHARS);
  });
});

describe('chunkConversation — oversized messages (#517)', () => {
  it('is byte-identical to the fits-under-budget path for a realistic corpus', () => {
    const chunks = chunkConversation([
      userMsg('m1', 'How does search work?', 0),
      assistantMsg('m2', 'Full-text plus trigram.', 1),
      userMsg('m3', 'ПРИВЕТ Café, any gotchas?', 2),
      assistantMsg('m4', 'None that I know of.', 3),
    ]);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    }
    // Everything fits in one chunk; the join is exactly the v2 shape — role
    // markers, `\n\n`-joined, no split/anchor machinery engaged at all.
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(
      '[user] How does search work?\n\n' +
        '[assistant] Full-text plus trigram.\n\n' +
        '[user] ПРИВЕТ Café, any gotchas?\n\n' +
        '[assistant] None that I know of.',
    );
  });

  it('splits an oversized user message with no anchor, and every chunk fits the budget', () => {
    const big = 'x'.repeat(CHUNK_MAX_CHARS + 4500); // no whitespace: forces hard cuts
    const chunks = chunkConversation([userMsg('u1', big, 0)]);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
      expect(chunk.content).not.toContain('[context:');
      expect(chunk.firstMessageId).toBe('u1');
      expect(chunk.lastMessageId).toBe('u1');
    }

    // Lossless coverage: stripping the constant "[user] " prefix from every
    // chunk and concatenating in order reproduces the original text exactly
    // — nothing dropped, nothing duplicated. Each chunk here maps to exactly
    // one slice because every non-final slice fills its full budget (>=
    // maxChars), which the packer's overlap rule refuses to carry forward.
    const reconstructed = chunks
      .map((c) => c.content.replace(/^\[user\] /, ''))
      .join('');
    expect(reconstructed).toBe(big);
  });

  it('chunks a large unspaced message correctly (quadratic-slice regression, #517)', () => {
    // 500KB with no whitespace anywhere forces the hard-cut path on every
    // slice — the worst case for a splitter that re-slices a shrinking
    // "remaining" string each iteration (O(N^2) in message length). This test
    // pins correctness (exact reconstruction), not wall-clock time, which
    // would be flaky; the whole point of the linear-cursor fix is that this
    // now runs in a fraction of a second instead of visibly hanging.
    const big = 'x'.repeat(500_000);
    const chunks = chunkConversation([userMsg('u1', big, 0)]);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    }

    // Same lossless-coverage argument as the smaller oversized-message case
    // above: every non-final slice fills its full budget, so the packer never
    // carries one forward as overlap, and stripping the constant prefix from
    // each chunk and concatenating reproduces the original text exactly.
    const reconstructed = chunks
      .map((c) => c.content.replace(/^\[user\] /, ''))
      .join('');
    expect(reconstructed).toBe(big);
  });

  it('anchors continuation slices of an oversized assistant message to the preceding user message', () => {
    const question = 'What should the migration plan be?';
    const answer = 'y'.repeat(CHUNK_MAX_CHARS + 500); // one boundary-free split
    const chunks = chunkConversation([
      userMsg('u1', question, 0),
      assistantMsg('a1', answer, 1),
    ]);

    // NOT a strict <= CHUNK_MAX_CHARS check here: this layer guarantees each
    // MessageBlock (one slice) fits the budget, which is what makes the
    // message coverage/anchor invariants below hold. The PACKED chunk can
    // still legitimately combine two under-budget blocks whose sum exceeds
    // CHUNK_MAX_CHARS — chunkByCharBudget's overlap-carry always takes at
    // least one new item onto a carried-over tail regardless of the running
    // total, and its `sizeOf` doesn't count the `\n\n` join either. This is
    // pre-existing packer behavior, not introduced here: two ordinary
    // 2997-char blocks (well under budget individually) already pack into a
    // 5996-char chunk on master today. Exit criterion 2.5 requires v3 to stay
    // byte-identical to v2 for every fitting input, so this layer cannot
    // (and does not try to) change that packing behavior.
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(2 * CHUNK_MAX_CHARS);
    }

    const assistantChunks = chunks.filter((c) =>
      c.content.includes('[assistant]'),
    );
    expect(assistantChunks.length).toBeGreaterThan(1);

    // First slice: no anchor.
    expect(assistantChunks[0].content).not.toContain('[context:');
    // A later slice: anchor present, quoting the preceding user question.
    const anchored = assistantChunks.find((c) =>
      c.content.includes('[context:'),
    );
    expect(anchored).toBeDefined();
    expect(anchored!.content).toContain(`[context: ${question}] `);
    expect(
      assistantChunks.map((chunk) => chunk.firstMessageTextOffset),
    ).toEqual(
      assistantChunks
        .map((chunk) => chunk.firstMessageTextOffset)
        .toSorted((left, right) => left - right),
    );
    expect(assistantChunks[0]).toMatchObject({
      firstMessageTextOffset: 0,
    });
    const finalAssistantChunk = assistantChunks.at(-1);
    expect(finalAssistantChunk).toMatchObject({
      lastMessageTextOffsetExclusive: answer.length,
    });

    // The anchor is content-only: normalizedContent (built from lexicalContent)
    // must never carry it, or it would become trigram/FTS-matchable.
    for (const chunk of chunks) {
      expect(chunk.normalizedContent).not.toContain('context:');
    }
  });

  it('uses the full anchor when the preceding user text is exactly at the anchor cap', () => {
    const question = 'q'.repeat(CHUNK_ANCHOR_MAX_CHARS);
    const answer = 'a'.repeat(CHUNK_MAX_CHARS + 500);
    const chunks = chunkConversation([
      userMsg('u1', question, 0),
      assistantMsg('a1', answer, 1),
    ]);
    const anchored = chunks.find((chunk) =>
      chunk.content.includes('[context:'),
    );

    expect(anchored).toBeDefined();
    expect(anchored!.content).toContain(`[context: ${question}] `);
    expect(anchored!.content).not.toContain('…');
  });

  it('does not emit an empty trailing continuation slice at an exact cursor boundary', () => {
    const answer = 'a'.repeat(CHUNK_MAX_CHARS - '[assistant] '.length + 1);
    const chunks = chunkConversation([assistantMsg('a1', answer, 0)]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((chunk) => chunk.content.endsWith('[assistant] '))).toBe(
      false,
    );
    expect(chunks.at(-1)?.lastMessageTextOffsetExclusive).toBe(answer.length);
  });

  it('anchors a later oversized assistant to the latest preceding user, not an assistant turn', () => {
    const answer = 'a'.repeat(CHUNK_MAX_CHARS + 500);
    const chunks = chunkConversation([
      userMsg('u1', 'the actual question', 0),
      assistantMsg('a0', 'short acknowledgement', 1),
      assistantMsg('a1', answer, 2),
    ]);
    const anchored = chunks.find((chunk) =>
      chunk.content.includes('[context:'),
    );

    expect(anchored).toBeDefined();
    expect(anchored!.content).toContain('[context: the actual question] ');
    expect(anchored!.content).not.toContain('short acknowledgement');
  });

  it('emits no anchor for an oversized message that is itself a user message, even with a preceding user message', () => {
    // A preceding user message exists (unusual turn order, but the type
    // permits it) — proving the exclusion is keyed on the oversized
    // message's OWN role, not merely on precedingUserText being unset.
    const chunks = chunkConversation([
      userMsg('u0', 'first question', 0),
      userMsg('u1', 'z'.repeat(CHUNK_MAX_CHARS + 1000), 1),
    ]);
    for (const chunk of chunks) {
      expect(chunk.content).not.toContain('[context:');
    }
  });

  it('emits no anchor for an oversized message with no preceding user message', () => {
    // Assistant message with nothing before it: no user turn to anchor to.
    const chunks = chunkConversation([
      assistantMsg('a1', 'w'.repeat(CHUNK_MAX_CHARS + 1000), 0),
    ]);
    for (const chunk of chunks) {
      expect(chunk.content).not.toContain('[context:');
    }
  });

  it('truncates a preceding user message longer than CHUNK_ANCHOR_MAX_CHARS at a word boundary with an elision marker', () => {
    const longQuestion = Array.from({ length: 100 }, (_, i) => `word${i}`).join(
      ' ',
    ); // well over CHUNK_ANCHOR_MAX_CHARS, plenty of word boundaries
    expect(longQuestion.length).toBeGreaterThan(CHUNK_ANCHOR_MAX_CHARS);

    const answer = 'v'.repeat(CHUNK_MAX_CHARS + 500);
    const chunks = chunkConversation([
      userMsg('u1', longQuestion, 0),
      assistantMsg('a1', answer, 1),
    ]);

    const anchored = chunks.find((c) => c.content.includes('[context:'));
    expect(anchored).toBeDefined();

    const match = /\[context: ([^\]]*)\] /.exec(anchored!.content);
    expect(match).not.toBeNull();
    const excerpt = match![1];

    expect(excerpt.length).toBeLessThanOrEqual(CHUNK_ANCHOR_MAX_CHARS + 1); // +1 for the elision mark
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).not.toBe(longQuestion);
    // Cut at a word boundary: the excerpt minus the marker is a clean prefix
    // ending on a full "wordN" token, never a partial one.
    const withoutMarker = excerpt.slice(0, -1);
    expect(longQuestion.startsWith(withoutMarker)).toBe(true);
    expect(/\bword\d+$/.test(withoutMarker)).toBe(true);
  });

  it('is deterministic for an oversized conversation (identical input → byte-identical chunks)', () => {
    const convo = [
      userMsg('u1', 'question about the rollout', 0),
      assistantMsg('a1', 'p'.repeat(CHUNK_MAX_CHARS + 900), 1),
    ];
    expect(chunkConversation(convo)).toEqual(chunkConversation(convo));
  });

  it('never splits a surrogate pair (e.g. an emoji) when the hard-cut fallback lands mid-character', () => {
    // No whitespace anywhere: forces findCutIndex's final hard-cut fallback.
    // The emoji straddles the exact firstMax boundary for a user message
    // ('[user] ' prefix, 7 chars → firstMax = CHUNK_MAX_CHARS - 7 = 2993), so
    // an unguarded `return maxLen` would cut between its two UTF-16 code units.
    const before = 'x'.repeat(CHUNK_MAX_CHARS - 8);
    const big = `${before}\u{1F600}${'x'.repeat(20)}`; // 😀 is a surrogate pair
    const chunks = chunkConversation([userMsg('u1', big, 0)]);

    expect(chunks.length).toBeGreaterThan(1);
    const loneSurrogate =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const chunk of chunks) {
      expect(loneSurrogate.test(chunk.content)).toBe(false);
    }

    // The emoji survives fully intact in exactly one chunk, never torn across
    // a chunk boundary. (Not a full-text reconstruction check: adjacent chunks
    // can legitimately overlap by a whole carried-over block — see the
    // "no anchor" oversized-message test above — so naive concatenation of
    // every chunk isn't expected to reproduce `big` byte-for-byte here.)
    const chunksWithEmoji = chunks.filter((c) => c.content.includes('😀'));
    expect(chunksWithEmoji).toHaveLength(1);
  });
});
