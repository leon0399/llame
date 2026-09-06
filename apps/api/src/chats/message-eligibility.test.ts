import { PgDialect } from 'drizzle-orm/pg-core';

import { eligibleMessagePredicate } from './message-eligibility';

const dialect = new PgDialect();
const compile = (alias: string) =>
  dialect.sqlToQuery(eligibleMessagePredicate(alias));

describe('eligibleMessagePredicate', () => {
  it('qualifies the role/usage columns against the caller-supplied alias', () => {
    const { sql: text, params } = compile('em');

    expect(text).toContain('"em".role');
    expect(text).toContain('"em".usage');
    // No accidental cross-alias leak from a different call site.
    expect(text).not.toContain('"m".role');
    expect(params).toStrictEqual([]);
  });

  it('admits every user row unconditionally, via a top-level OR', () => {
    const { sql: text } = compile('m');

    expect(text).toMatch(/^\(\s*"m"\.role = 'user'\s*OR \(/);
  });

  it('admits an assistant row only when usage does not name an incomplete status', () => {
    const { sql: text } = compile('m');

    expect(text).toContain('"m".role = \'assistant\'');
    expect(text).toContain('"m".usage IS NULL');
    expect(text).toContain('jsonb_typeof("m".usage) <> \'object\'');
    expect(text).toContain('NOT ("m".usage ? \'status\')');
    expect(text).toContain("\"m\".usage ->> 'status' = 'completed'");
  });

  it('ANDs the role check with the usage-completeness check for assistant rows', () => {
    const { sql: text } = compile('m');
    const assistantBranch = text.slice(
      text.indexOf('"m".role = \'assistant\''),
    );

    expect(assistantBranch).toMatch(/'assistant'\s*AND \(/);
  });
});
