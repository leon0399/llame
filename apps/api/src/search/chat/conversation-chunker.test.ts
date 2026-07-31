import {
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
            type: 'data-model-context',
            data: {
              kind: 'model_switch',
              fromModelId: 'zzprevmodelquartz',
              toModelId: 'zzcurrentmodelvelvet',
              runId: '11111111-1111-4111-8111-111111111111',
              generatedReminderFixture: 'zzreminderprosecobalt',
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
      /zz(prevmodel|currentmodel|reminderprose|checkpoint|systemprompt|toolschema)/,
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

  it('is deterministic (identical input → byte-identical chunks + hashes)', () => {
    const convo = [userMsg('m1', 'alpha', 0), assistantMsg('m2', 'beta', 1)];
    expect(chunkConversation(convo)).toEqual(chunkConversation(convo));
  });

  it('splits across chunks on the char budget with 1-message overlap', () => {
    const big = 'x'.repeat(CHUNK_MAX_CHARS - 10);
    const chunks = chunkConversation([
      userMsg('m1', big, 0),
      assistantMsg('m2', big, 1),
      userMsg('m3', big, 2),
    ]);
    expect(chunks.length).toBeGreaterThan(1);
    // Overlap: chunk N's last message is chunk N+1's first.
    expect(chunks[0].lastMessageId).toBe(chunks[1].firstMessageId);
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
});
