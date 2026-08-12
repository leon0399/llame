/**
 * MemoryRepository — owner-scoped database access.
 *
 * Every query retains an owner filter as defense-in-depth behind the primary
 * isolation guarantee: the FORCEd `memory_settings_owner_*` RLS policies.
 */

import { eq } from 'drizzle-orm';

import { type MemorySettings, memorySettings } from '../db/schema';
import { type Db } from '../db/tenant-db.service';

export type MemorySettingsUpdate = {
  shareRecentChats?: boolean;
};

export class MemoryRepository {
  constructor(private readonly db: Db) {}

  async findForOwner(ownerUserId: string): Promise<MemorySettings | undefined> {
    const [row] = await this.db
      .select()
      .from(memorySettings)
      .where(eq(memorySettings.userId, ownerUserId))
      .limit(1);
    return row;
  }

  async upsertForOwner(
    ownerUserId: string,
    update: MemorySettingsUpdate,
  ): Promise<MemorySettings> {
    const [row] = await this.db
      .insert(memorySettings)
      .values({ userId: ownerUserId, ...update })
      .onConflictDoUpdate({
        target: memorySettings.userId,
        set: { ...update, updatedAt: new Date() },
      })
      .returning();
    return row;
  }
}
