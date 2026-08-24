import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('knowledge_spaces migration', () => {
  it('backfills labels/timestamps, drops owner uniqueness, and forces RLS', () => {
    const migration = readFileSync(
      join(__dirname, 'migrations', '20260823195052_yummy_sinister_six.sql'),
      'utf8',
    );

    expect(migration).toMatch(
      /ALTER TABLE "knowledge_spaces" ADD(?: COLUMN)? "name" text DEFAULT 'Personal' NOT NULL;/,
    );
    expect(migration).toMatch(
      /ALTER TABLE "knowledge_spaces" ADD(?: COLUMN)? "created_at" timestamp \(3\) with time zone DEFAULT now\(\) NOT NULL;/,
    );
    expect(migration).toMatch(
      /ALTER TABLE "knowledge_spaces" ADD(?: COLUMN)? "updated_at" timestamp \(3\) with time zone DEFAULT now\(\) NOT NULL;/,
    );
    expect(migration).toContain(
      'DROP CONSTRAINT "knowledge_spaces_owner_user_id_unique"',
    );
    expect(migration).toContain(
      'ALTER TABLE "knowledge_spaces" FORCE ROW LEVEL SECURITY;',
    );
    expect(migration).not.toContain('DROP TABLE "knowledge_spaces"');
  });
});
