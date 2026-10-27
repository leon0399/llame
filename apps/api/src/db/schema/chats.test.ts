/**
 * The follow-up columns of the `runs` table (turn-actions D3): the CHECK that
 * keeps the action domain, and the composite foreign key that keeps a source
 * Run in the same owner's hands. Both carry database-visible names, so a
 * rename here would silently rename a constraint the migrations hold.
 */

import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { runs } from './index';

const dialect = new PgDialect();

describe('runs follow-up schema', () => {
  it('enforces the follow-up action domain under its named CHECK', () => {
    const check = getTableConfig(runs).checks.find(
      (entry) => entry.name === 'runs_follow_up_action_check',
    );
    if (check === undefined) {
      throw new Error('runs_follow_up_action_check is missing');
    }
    const sql = dialect
      .sqlToQuery(check.value)
      .sql.replaceAll(/\s+/gu, ' ')
      .toLowerCase();

    expect(sql).toContain(
      '"runs"."follow_up_action" is null or "runs"."follow_up_action" in (',
    );
    expect(sql).toContain("'continue'");
    expect(sql).toContain("'regenerate'");
  });

  it('names the owner-matching source Run foreign key', () => {
    const names = getTableConfig(runs).foreignKeys.map((key) => key.getName());

    expect(names).toContain('runs_source_run_id_user_id_fk');
  });
});
