import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantDbService } from '../db/tenant-db.service';
import { ModelsModule } from '../models/models.module';
import { ChatLoopService } from './chat-loop.service';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import { QueueModule } from '../queue/queue.module';
import { CompactionService } from './compaction.service';
import { RunAbortRegistry } from './run-abort-registry';
import { RunExecutionService } from './run-execution.service';
import { RunStreamBridgeService } from './run-stream-bridge';
import { RunsController } from './runs.controller';
import { RunsWorkerService } from './runs-worker.service';
import { TitleService } from './title.service';

// HTTP endpoints are safe to expose only because SessionAuthGuard derives the tenant
// identity from a verified session. Controllers must never accept ownerUserId from
// client input; that would recreate the #61 tenant-impersonation IDOR.
@Module({
  imports: [AuthModule, ModelsModule, QueueModule],
  controllers: [ChatsController, RunsController],
  providers: [
    TenantDbService,
    ChatsService,
    ChatLoopService,
    RunExecutionService,
    RunStreamBridgeService,
    RunsWorkerService,
    RunAbortRegistry,
    CompactionService,
    TitleService,
  ],
  exports: [ChatsService],
})
export class ChatsModule {}
