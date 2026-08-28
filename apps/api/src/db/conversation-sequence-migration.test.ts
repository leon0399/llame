import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(__dirname, 'migrations', '20260828123726_flowery_nitro.sql'),
  'utf8',
);

describe('Chat-local conversation sequence migration', () => {
  it('preflights old locator observations with the required FORCE-RLS windows', () => {
    expect(migration).toContain(
      'ALTER TABLE "messages" NO FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      'ALTER TABLE "run_events" NO FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain("'tool-conversation_read'");
    expect(migration).toContain("'tool-search_conversations'");
    expect(migration).toContain('c."replacement_history"');
    expect(migration).toContain(
      'ALTER TABLE "run_events" FORCE ROW LEVEL SECURITY',
    );
    expect(
      migration.indexOf('Chat-local sequence cutover refused'),
    ).toBeLessThan(migration.indexOf('ALTER COLUMN "seq" DROP IDENTITY'));
  });

  it('maps messages and compaction boundaries before restoring FORCE RLS', () => {
    expect(migration).toContain('CREATE TEMP TABLE message_sequence_mapping');
    expect(migration).toContain('row_number() OVER');
    expect(migration).toContain(
      'ALTER TABLE "compactions" NO FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain('UPDATE "compactions"');
    expect(migration).toContain('UPDATE "messages"');
    expect(migration).toContain(
      'ALTER TABLE "messages" FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      'ALTER TABLE "compactions" FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain('relforcerowsecurity');
    expect(migration).toContain('DROP INDEX "compactions_chat_upto_seq_idx"');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "compactions_chat_upto_seq_idx"',
    );
    expect(
      migration.lastIndexOf('ALTER TABLE "messages" FORCE ROW LEVEL SECURITY'),
    ).toBeLessThan(migration.lastIndexOf('relforcerowsecurity'));
  });
});
