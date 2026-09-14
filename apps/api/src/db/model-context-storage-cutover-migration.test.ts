import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function cutoverMigration(): string {
  return readFileSync(
    join(__dirname, 'migrations', '20260914091147_great_iron_patriot.sql'),
    'utf8',
  );
}

describe('model-context storage cutover migration', () => {
  it('uses the exact seven-statement cutover sequence', () => {
    const statements = cutoverMigration()
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);

    expect(statements).toHaveLength(7);
    expect(statements[0]).toMatch(/^--[\s\S]*DO \$migration\$/);
    expect(statements[1]).toMatch(
      /^--[\s\S]*CREATE UNIQUE INDEX IF NOT EXISTS "runs_id_user_id_unique_idx"/,
    );
    expect(statements[2]).toMatch(/^DO \$migration\$/);
    expect(statements[3]).toContain(
      'ALTER TABLE "runs"\n  DROP CONSTRAINT IF EXISTS "runs_model_context_snapshot_id_user_id_fk"',
    );
    expect(statements[4]).toBe(
      'DROP INDEX IF EXISTS "runs_model_context_snapshot_idx";',
    );
    expect(statements[5]).toContain(
      'ALTER TABLE "runs"\n  DROP COLUMN IF EXISTS "model_context_snapshot_id"',
    );
    expect(statements[6]).toBe(
      'DROP TABLE IF EXISTS "model_context_snapshots" CASCADE;',
    );
  });

  it('backfills one deterministic system receipt and fences historical winners', () => {
    const sql = cutoverMigration();
    const noForce = sql.indexOf(
      'ALTER TABLE "runs" NO FORCE ROW LEVEL SECURITY',
    );
    const insert = sql.indexOf('INSERT INTO "system_prompt_receipts"');
    const force = sql.indexOf('ALTER TABLE "runs" FORCE ROW LEVEL SECURITY');

    expect(noForce).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(noForce);
    expect(force).toBeGreaterThan(insert);
    expect(sql).toContain(
      'md5(\'llame:model-context:historical-attempt:v1:\' || r."id"::text)::uuid',
    );
    expect(sql).toContain('s."source"');
    expect(sql).toContain('s."system_prompt"');
    expect(sql).toContain('s."prompt_hash"');
    expect(sql).toContain('s."created_at"');
    expect(sql).toContain(
      'ON CONFLICT ("owner_user_id", "run_id", "attempt_id") DO NOTHING',
    );
    expect(sql).toContain('r."completed_attempt_id" IS NULL');
  });

  it('converts only observed v1 availability and preserves RLS boundaries', () => {
    const sql = cutoverMigration();
    const availability = sql.indexOf('SET "turn_tool_availability" = COALESCE');

    expect(availability).toBeGreaterThanOrEqual(0);
    expect(sql).toContain("s.\"tool_availability_manifest\"->>'version' = '1'");
    expect(sql).toContain(
      "jsonb_typeof(s.\"tool_availability_manifest\"->'entries') = 'array'",
    );
    expect(sql).toContain("entry->>'state' IN ('available', 'unavailable')");
    expect(sql).toContain("'[]'::jsonb");
    expect(sql).toContain('r."status" = \'completed\'');
    expect(sql).not.toContain("'unobserved'");

    const noForce = sql.indexOf(
      'ALTER TABLE "model_context_snapshots" NO FORCE ROW LEVEL SECURITY',
    );
    const force = sql.indexOf(
      'ALTER TABLE "model_context_snapshots" FORCE ROW LEVEL SECURITY',
    );
    expect(noForce).toBeGreaterThanOrEqual(0);
    expect(force).toBeGreaterThan(noForce);
  });

  it('keeps reruns harmless and converges the owner-matching receipt FK', () => {
    const sql = cutoverMigration();
    expect(sql).toContain("to_regclass('public.model_context_snapshots')");
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
    const drop = sql.indexOf(
      'DROP CONSTRAINT IF EXISTS "system_prompt_receipts_run_id_user_id_fk"',
    );
    const add = sql.indexOf(
      'ADD CONSTRAINT "system_prompt_receipts_run_id_user_id_fk"',
    );
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(add).toBeGreaterThan(drop);
    expect(sql).toContain('DROP COLUMN IF EXISTS');
    expect(sql).toContain('DROP TABLE IF EXISTS');
    expect(sql).toContain('FOREIGN KEY ("run_id", "owner_user_id")');
    expect(sql).toContain('REFERENCES "public"."runs" ("id", "user_id")');
    expect(sql).toContain('ON DELETE CASCADE ON UPDATE NO ACTION');
    expect(sql).not.toContain('ON DELETE NO ACTION');
  });
});
