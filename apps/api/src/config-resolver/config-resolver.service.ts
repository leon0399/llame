import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Db, TenantDbService } from '../db/tenant-db.service';
import { type RunConfigSnapshot } from './effective-config';
import { ConfigsRepository, type ScopeKey } from './configs-repository';
import { resolveLayers, type ConfigLayer } from './merge';

/**
 * ConfigResolverService (#46, SPEC §6.3–§6.4): compute the effective config
 * for a context by merging the scope chain, with per-leaf provenance.
 *
 * Chain today: instance (env-derived) → user → chat. Org-unit layers slot in
 * between instance and user (root-first, path order) once chats/projects
 * attach to org units (v0.5) — the engine and the storage already accept
 * them; the CONTEXT simply has no org linkage yet.
 *
 * The resolved result is snapshotted onto the run row at creation (SPEC §6.4,
 * guiding principle 4) — execution reads the snapshot, never live config.
 * Policy-based capability stripping is #45's step and composes after the
 * merge.
 */
@Injectable()
export class ConfigResolverService {
  constructor(
    private readonly config: ConfigService,
    private readonly tenantDb: TenantDbService,
  ) {}

  /**
   * The instance layer: env-derived defaults (version 0, no row). Becomes an
   * admin-editable configs row when an instance-admin surface exists.
   */
  private instanceLayer(): ConfigLayer {
    const config: Record<string, unknown> = {};

    const maxOutputTokens = envPositiveInt(
      this.config.get<string>('RUN_MAX_OUTPUT_TOKENS'),
    );
    if (maxOutputTokens !== undefined) {
      config.run = { maxOutputTokens };
    }
    const tokenThreshold = envPositiveInt(
      this.config.get<string>('COMPACTION_TOKEN_THRESHOLD'),
    );
    if (tokenThreshold !== undefined) {
      config.compaction = { tokenThreshold };
    }

    return {
      scope: { scopeType: 'instance', scopeId: null, version: 0 },
      config,
    };
  }

  /**
   * Resolve within an existing tenant transaction — the chat-loop calls this
   * inside the same tx that creates the run, so the snapshot is consistent
   * with the message write.
   */
  async resolveForChatWithin(
    tx: Db,
    input: { userId: string; chatId: string },
  ): Promise<RunConfigSnapshot> {
    const keys: ScopeKey[] = [
      { scopeType: 'user', scopeId: input.userId },
      { scopeType: 'chat', scopeId: input.chatId },
    ];
    const rows = await new ConfigsRepository(tx).findByScopes(keys);
    const byKey = new Map(rows.map((r) => [`${r.scopeType}:${r.scopeId}`, r]));

    const layers: ConfigLayer[] = [this.instanceLayer()];
    for (const key of keys) {
      const row = byKey.get(`${key.scopeType}:${key.scopeId}`);
      layers.push({
        scope: {
          scopeType: key.scopeType,
          scopeId: key.scopeId,
          version: row?.version ?? 0,
        },
        config: (row?.config ?? {}) as Record<string, unknown>,
      });
    }

    const resolved = resolveLayers(layers);
    return { ...resolved, computedAt: new Date().toISOString() };
  }

  /** Standalone resolution (the explain endpoint). */
  async resolveForChat(input: {
    userId: string;
    chatId: string;
  }): Promise<RunConfigSnapshot> {
    return this.tenantDb.runAs(input.userId, (tx) =>
      this.resolveForChatWithin(tx, input),
    );
  }
}

function envPositiveInt(raw: string | undefined): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}
