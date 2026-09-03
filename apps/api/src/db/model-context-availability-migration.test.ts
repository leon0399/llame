import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  hashToolAvailabilityManifest,
  TOOL_AVAILABILITY_UNOBSERVED,
} from '../tools/turn-tool-catalog';

type Migration = { name: string; sql: string };

function readMigrations(): Array<Migration> {
  const migrationsDirectory = join(__dirname, 'migrations');
  return readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({
      name,
      sql: readFileSync(join(migrationsDirectory, name), 'utf8'),
    }));
}

describe('model-context availability migration', () => {
  it('backfills the exact v0 sentinel/hash without changing historical content hashes', () => {
    const candidates = readMigrations().filter(({ sql }) =>
      sql.includes('ADD COLUMN "tool_availability_manifest"'),
    );

    expect(candidates).toHaveLength(1);
    const migration = candidates[0];
    const expectedHash = hashToolAvailabilityManifest(
      TOOL_AVAILABILITY_UNOBSERVED,
    );
    const noForce = migration.sql.indexOf(
      'ALTER TABLE "model_context_snapshots" NO FORCE ROW LEVEL SECURITY',
    );
    const backfill = migration.sql.indexOf(
      `SET "tool_availability_manifest" = '{"version":0,"state":"unobserved"}'::jsonb, "availability_hash" = '${expectedHash}'`,
    );
    const force = migration.sql.indexOf(
      'ALTER TABLE "model_context_snapshots" FORCE ROW LEVEL SECURITY',
    );

    expect(noForce).toBeGreaterThanOrEqual(0);
    expect(backfill).toBeGreaterThan(noForce);
    expect(force).toBeGreaterThan(backfill);
    expect(migration.sql).toMatch(
      /ADD COLUMN "availability_hash" text DEFAULT '[0-9a-f]{64}'/,
    );
    expect(migration.sql).toContain(
      `ADD COLUMN "tool_availability_manifest" jsonb DEFAULT '{"version":0,"state":"unobserved"}'::jsonb`,
    );
    expect(migration.sql).toContain(
      'ALTER COLUMN "tool_availability_manifest" SET NOT NULL',
    );
    expect(migration.sql).toContain(
      'ALTER COLUMN "availability_hash" SET NOT NULL',
    );
    expect(migration.sql).toContain(
      'CREATE UNIQUE INDEX "model_context_snapshots_owner_content_avail_source_uidx"',
    );
    expect(migration.sql).not.toContain(
      'DROP INDEX "model_context_snapshots_owner_content_source_unique_idx"',
    );
    expect(migration.sql).not.toMatch(
      /UPDATE "model_context_snapshots"[\s\S]*SET[^;]*"content_hash"\s*=/,
    );
  });

  it('keeps old-writer inserts valid during preparation via v0 defaults and the legacy conflict index', () => {
    const migration = readMigrations().find(({ sql }) =>
      sql.includes('ADD COLUMN "tool_availability_manifest"'),
    )?.sql;

    expect(migration).toBeDefined();
    expect(migration).toMatch(
      /ADD COLUMN "availability_hash" text DEFAULT '[0-9a-f]{64}'/,
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "model_context_snapshots_owner_content_avail_source_uidx"',
    );
    expect(migration).not.toContain(
      'DROP INDEX "model_context_snapshots_owner_content_source_unique_idx"',
    );
  });

  it('limits cutover to dropping preparation defaults and the legacy conflict index', () => {
    const migration = readMigrations().find(({ sql }) =>
      sql.includes(
        'DROP INDEX "model_context_snapshots_owner_content_source_unique_idx"',
      ),
    );

    expect(migration).toBeDefined();
    const statements = migration!.sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);

    expect(new Set(statements)).toEqual(
      new Set([
        'ALTER TABLE "model_context_snapshots" ALTER COLUMN "availability_hash" DROP DEFAULT;',
        'ALTER TABLE "model_context_snapshots" ALTER COLUMN "tool_availability_manifest" DROP DEFAULT;',
        'DROP INDEX "model_context_snapshots_owner_content_source_unique_idx";',
      ]),
    );
    expect(statements).toHaveLength(3);
    expect(migration!.sql).not.toMatch(
      /ADD COLUMN|UPDATE "model_context_snapshots"|CREATE UNIQUE INDEX|SET NOT NULL/,
    );
  });
});
