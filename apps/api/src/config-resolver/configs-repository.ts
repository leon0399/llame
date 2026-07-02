/**
 * ConfigsRepository (#46) — scope-config rows. RLS (FORCE) scopes reads and
 * writes per scope type (own user scope, owned chat scope, membership/admin
 * on org-unit scope); see the configs table policies.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { configs, type ConfigRow, type ConfigScopeType } from '../db/schema';
import { type Db } from '../db/tenant-db.service';

export type ScopeKey = { scopeType: ConfigScopeType; scopeId: string };

export class ConfigsRepository {
  constructor(private readonly db: Db) {}

  /** All config rows for the given scope keys (one round trip). */
  async findByScopes(keys: ScopeKey[]): Promise<ConfigRow[]> {
    if (keys.length === 0) {
      return [];
    }
    // Scope ids are globally unique across types in practice, but filter on
    // the exact (type, id) pairs anyway — correctness over cleverness.
    const rows = await this.db
      .select()
      .from(configs)
      .where(
        inArray(
          configs.scopeId,
          keys.map((k) => k.scopeId),
        ),
      );
    const wanted = new Set(keys.map((k) => `${k.scopeType}:${k.scopeId}`));
    return rows.filter((r) => wanted.has(`${r.scopeType}:${r.scopeId}`));
  }

  /**
   * Set a scope's config document, bumping `version` on every write — the
   * run snapshot's `layers` record which version each resolution consumed.
   */
  async upsert(input: {
    scopeType: ConfigScopeType;
    scopeId: string;
    config: Record<string, unknown>;
  }): Promise<ConfigRow> {
    const [row] = await this.db
      .insert(configs)
      .values(input)
      .onConflictDoUpdate({
        target: [configs.scopeType, configs.scopeId],
        set: {
          config: input.config,
          version: sql`${configs.version} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async remove(scopeType: ConfigScopeType, scopeId: string): Promise<void> {
    await this.db
      .delete(configs)
      .where(
        and(eq(configs.scopeType, scopeType), eq(configs.scopeId, scopeId)),
      );
  }
}
