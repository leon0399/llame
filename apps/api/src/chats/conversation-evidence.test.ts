import {
  isImmutableEvidenceMessage,
  visibleMessageText,
} from './conversation-evidence';

describe('conversation evidence', () => {
  describe('visibleMessageText', () => {
    it('joins retained text parts with exactly two newlines in stored order', () => {
      expect(
        visibleMessageText([
          { type: 'text', text: 'alpha' },
          { type: 'reasoning', text: 'hidden' },
          { type: 'tool-search', output: 'also hidden' },
          { type: 'text', text: 'beta' },
          { type: 'text', text: 'gamma' },
        ]),
      ).toBe('alpha\n\nbeta\n\ngamma');
    });

    it('preserves text-part whitespace and line delimiters byte-for-byte', () => {
      expect(
        visibleMessageText([
          { type: 'text', text: '  alpha\n' },
          { type: 'text', text: '\n beta \t' },
        ]),
      ).toBe('  alpha\n\n\n\n beta \t');
    });

    it('returns no bytes when a message has no text parts', () => {
      expect(
        visibleMessageText([
          { type: 'reasoning', text: 'hidden' },
          { type: 'tool-search', output: 'hidden' },
          { type: 'file', url: 'https://example.test/file' },
        ]),
      ).toBe('');
    });
  });

  describe('isImmutableEvidenceMessage', () => {
    it('allows user messages', () => {
      expect(isImmutableEvidenceMessage({ role: 'user' })).toBe(true);
    });

    it('allows completed and legacy assistant messages', () => {
      expect(
        isImmutableEvidenceMessage({
          role: 'assistant',
          usage: { status: 'completed' },
        }),
      ).toBe(true);
      expect(isImmutableEvidenceMessage({ role: 'assistant' })).toBe(true);
      expect(isImmutableEvidenceMessage({ role: 'assistant', usage: {} })).toBe(
        true,
      );
    });

    it('excludes retryable assistant messages', () => {
      expect(
        isImmutableEvidenceMessage({
          role: 'assistant',
          usage: { status: 'error' },
        }),
      ).toBe(false);
      expect(
        isImmutableEvidenceMessage({
          role: 'assistant',
          usage: { status: null },
        }),
      ).toBe(false);
    });

    it('excludes irrelevant roles', () => {
      expect(isImmutableEvidenceMessage({ role: 'system' })).toBe(false);
      expect(isImmutableEvidenceMessage({ role: 'tool' })).toBe(false);
    });
  });
});
