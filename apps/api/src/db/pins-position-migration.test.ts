import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(__dirname, 'migrations', '20260826125629_gifted_tigra.sql'),
  'utf8',
);
const normalized = migration.replaceAll(/\s+/g, ' ');

describe('pins position migration', () => {
  it('backfills each owner from the prior pinned-at order before setting NOT NULL', () => {
    expect(normalized).toContain(
      'ROW_NUMBER() OVER ( PARTITION BY user_id ORDER BY pinned_at DESC, item_type, item_id ) - 1',
    );

    const noForce = migration.indexOf(
      'ALTER TABLE "pins" NO FORCE ROW LEVEL SECURITY',
    );
    const backfill = migration.indexOf('UPDATE pins AS p');
    const force = migration.indexOf(
      'ALTER TABLE "pins" FORCE ROW LEVEL SECURITY',
    );
    const notNull = migration.indexOf(
      'ALTER TABLE "pins" ALTER COLUMN "position" SET NOT NULL',
    );
    expect(noForce).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(noForce);
    expect(force).toBeGreaterThan(backfill);
    expect(notNull).toBeGreaterThan(force);
  });

  it('replaces the rail index, enforces owner-position uniqueness, and adds owner UPDATE RLS', () => {
    expect(migration).toContain('DROP INDEX "pins_user_pinned_idx"');
    expect(migration).toContain(
      'CREATE INDEX "pins_user_position_idx" ON "pins" USING btree ("user_id","position","item_id")',
    );
    expect(migration).toContain(
      'CONSTRAINT "pins_user_position_unique" UNIQUE("user_id","position")',
    );
    expect(migration).toContain('CREATE POLICY "pins_owner_update" ON "pins"');
  });
});
