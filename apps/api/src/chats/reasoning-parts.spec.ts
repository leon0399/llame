import {
  REASONING_PERSIST_MAX,
  assistantParts,
} from '../runs/run-execution.service';

describe('assistantParts (reasoning persistence)', () => {
  it('text-only when there was no reasoning (no empty reasoning part)', () => {
    expect(assistantParts('', 'the answer')).toEqual([
      { type: 'text', text: 'the answer' },
    ]);
  });

  it('prepends a reasoning part before the text when reasoning is present', () => {
    expect(assistantParts('let me think', 'the answer')).toEqual([
      { type: 'reasoning', text: 'let me think' },
      { type: 'text', text: 'the answer' },
    ]);
  });

  it('caps an oversized reasoning blob (bounds storage + per-turn read cost)', () => {
    const huge = 'x'.repeat(REASONING_PERSIST_MAX + 5000);
    const [reasoning, text] = assistantParts(huge, 'answer') as [
      { type: string; text: string },
      { type: string; text: string },
    ];
    expect(reasoning.type).toBe('reasoning');
    // Truncated to the cap + a marker; never the full oversized blob.
    expect(reasoning.text.length).toBe(REASONING_PERSIST_MAX + 1);
    expect(reasoning.text.endsWith('…')).toBe(true);
    expect(text).toEqual({ type: 'text', text: 'answer' });
  });

  it('reasoning-only turn: no empty text part when there is no answer text', () => {
    expect(assistantParts('thinking, no answer yet', '')).toEqual([
      { type: 'reasoning', text: 'thinking, no answer yet' },
    ]);
  });

  it('empty everything: no parts at all (not even an empty text part)', () => {
    expect(assistantParts('', '')).toEqual([]);
  });
});
