import { Module } from '@nestjs/common';
import { TenantDbService } from '../db/tenant-db.service';
import { TitleService } from './title.service';

/**
 * TitlesModule (#78) — post-turn chat title generation. Same deferred-work
 * shape as CompactionModule: fired by the chat loop today, moves to the
 * worker with it (#50).
 */
@Module({
  providers: [TenantDbService, TitleService],
  exports: [TitleService],
})
export class TitlesModule {}
