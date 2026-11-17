import { DEFAULT_DECISION_LIMITS } from '../instance-config/decision-catalog';
import { fitsLimits, packCards } from './request-packing';

describe('fitsLimits', () => {
  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    // "éééééé" serializes to 14 bytes but 8 code units; with "{}" the
    // per-request estimate is ceil(16 / 3) = 6 tokens, over a limit of 5.
    const request = { state: 'éééééé', questions: {} };

    expect(
      fitsLimits(request, {
        ...DEFAULT_DECISION_LIMITS,
        perQuestionContextTokens: 5,
        perRequestContextTokens: 5,
      }),
    ).toBe(false);
  });
});

describe('packCards', () => {
  it('cuts a card at a code-point boundary, never inside a surrogate pair', () => {
    const groups = packCards(
      [{ key: 'p0', text: '😀😀😀' }],
      (cards) => (cards[0]?.text.length ?? 0) <= 3,
      32,
    );

    expect(groups).toEqual([[{ key: 'p0', text: '😀' }]]);
  });
});
