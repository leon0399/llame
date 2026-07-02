import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantDbService } from '../db/tenant-db.service';
import { ModelsModule } from '../models/models.module';
import { ChatLoopService } from './chat-loop.service';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import { CompactionService } from './compaction.service';
import { RunsController } from './runs.controller';
import { TitleService } from './title.service';

// HTTP endpoints are safe to expose only because SessionAuthGuard derives the tenant
// identity from a verified session. Controllers must never accept ownerUserId from
// client input; that would recreate the #61 tenant-impersonation IDOR.
@Module({
  imports: [AuthModule, ModelsModule],
  controllers: [ChatsController, RunsController],
  providers: [
    TenantDbService,
    ChatsService,
    ChatLoopService,
    CompactionService,
    TitleService,
  ],
  exports: [ChatsService],
})
export class ChatsModule {}
