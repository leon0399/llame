import { Injectable } from '@nestjs/common';

import { type MemorySettings } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import {
  MemoryRepository,
  type MemorySettingsUpdate,
} from './memory-repository';

export type ResolvedMemorySettings = Pick<MemorySettings, 'shareRecentChats'>;

/** The narrow capability future history consumers are allowed to depend on. */
export type MemorySettingsResolver = Pick<MemoryService, 'getForOwner'>;

@Injectable()
export class MemoryService {
  constructor(private readonly tenantDb: TenantDbService) {}

  async getForOwner(userId: string): Promise<ResolvedMemorySettings> {
    const settings = await this.tenantDb.runAs(userId, (tx) =>
      new MemoryRepository(tx).findForOwner(userId),
    );

    // No row is the normal first-use state, not a separate state callers must
    // handle. Default once here so HTTP and future consumers cannot drift.
    return { shareRecentChats: settings?.shareRecentChats ?? false };
  }

  async updateForOwner(
    userId: string,
    update: MemorySettingsUpdate,
  ): Promise<ResolvedMemorySettings> {
    const settings = await this.tenantDb.runAs(userId, (tx) =>
      new MemoryRepository(tx).upsertForOwner(userId, update),
    );
    return { shareRecentChats: settings.shareRecentChats };
  }
}
