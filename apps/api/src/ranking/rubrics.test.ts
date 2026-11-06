import { describe, expect, it } from 'vitest';

import { GREP_RERANK_RUBRIC, WEB_SEARCH_RERANK_RUBRIC } from './rubrics';

describe('ranking rubrics', () => {
  it('renders the grep rubric from its packaged template', () => {
    expect(GREP_RERANK_RUBRIC).toBe(
      'Is this file likely to contain what the objective (or query) is looking for: a substantive implementation or explanation, not a mere mention?',
    );
  });

  it('renders the web_search rubric from its packaged template', () => {
    expect(WEB_SEARCH_RERANK_RUBRIC).toBe(
      'Does this result help answer the objective (or, without one, the query)?',
    );
  });
});
