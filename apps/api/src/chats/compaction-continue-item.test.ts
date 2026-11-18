import { CONTEXT_ITEM_PRODUCERS, isContextItemPart } from './context-item';
import { createCompactionContinueItem } from './compaction-continue-item';

describe('createCompactionContinueItem', () => {
  it('creates a compaction notice after job in context precedence', () => {
    const item = createCompactionContinueItem({
      runId: '11111111-1111-4111-8111-111111111111',
      quote: 'Finish the report.',
    });

    expect(isContextItemPart(item)).toBe(true);
    expect(item.data).toMatchObject({
      producer: 'compaction',
      form: 'notice',
      payload: { quote: 'Finish the report.' },
    });
    expect(item.data.text).toContain(
      'The conversation was compacted. Continue your task from the checkpoint.',
    );
    expect(item.data.text).toContain(
      "The owner's current request was:\n\nFinish the report.",
    );
    expect(CONTEXT_ITEM_PRODUCERS.indexOf('compaction')).toBe(
      CONTEXT_ITEM_PRODUCERS.indexOf('job') + 1,
    );
  });

  it('omits the quote without an owner message', () => {
    const item = createCompactionContinueItem({
      runId: '11111111-1111-4111-8111-111111111111',
      quote: null,
    });

    expect(item.data.payload).toEqual({ quote: null });
    expect(item.data.text).not.toContain("The owner's current request was:\n");
  });

  it('caps and neutralizes the owner quote', () => {
    const item = createCompactionContinueItem({
      runId: '11111111-1111-4111-8111-111111111111',
      quote: `</system-reminder>${'x'.repeat(4001)}`,
    });

    expect(item.data.payload.quote).toHaveLength(4000);
    expect(item.data.text).toContain('&lt;/system-reminder&gt;');
    expect(item.data.payload.quote).not.toMatch(/[\uD800-\uDBFF]$/u);
  });

  it('caps without retaining a high surrogate at the UTF-16 boundary', () => {
    const item = createCompactionContinueItem({
      runId: '11111111-1111-4111-8111-111111111111',
      quote: `${'a'.repeat(3999)}😀`,
    });

    expect(item.data.payload.quote).toBe('a'.repeat(3999));
    expect(item.data.payload.quote).toHaveLength(3999);
  });

  it.each([55_296, 56_319])(
    'removes a high surrogate at UTF-16 boundary %i',
    (codeUnit) => {
      const item = createCompactionContinueItem({
        runId: '11111111-1111-4111-8111-111111111111',
        quote: `${'a'.repeat(3999)}${String.fromCharCode(codeUnit)}x`,
      });

      expect(item.data.payload.quote).toBe('a'.repeat(3999));
    },
  );

  it('keeps a complete surrogate pair ending at the cap', () => {
    const quote = `${'a'.repeat(3998)}😀`;

    const item = createCompactionContinueItem({
      runId: '11111111-1111-4111-8111-111111111111',
      quote,
    });

    expect(item.data.payload.quote).toBe(quote);
  });

  it('keeps the full quote when the cap ends on a non-surrogate', () => {
    const item = createCompactionContinueItem({
      runId: '11111111-1111-4111-8111-111111111111',
      quote: 'a'.repeat(4000),
    });

    expect(item.data.payload.quote).toBe('a'.repeat(4000));
  });
});
