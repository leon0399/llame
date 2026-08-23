import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('knowledge_spaces migration', () => {
  it('forces RLS for the table-owning application role', () => {
    const migration = readFileSync(
      join(__dirname, 'migrations', '20260822233014_curved_gwen_stacy.sql'),
      'utf8',
    );

    expect(migration).toContain(
      'ALTER TABLE "knowledge_spaces" FORCE ROW LEVEL SECURITY;',
    );
  });
});
