import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ModelsModule } from '../models/models.module';
import { RunWorkerModule } from '../runs/run-worker.module';
import { RunsModule } from '../runs/runs.module';
import { ChatLoopService } from './chat-loop.service';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import { MeMemoriesController } from './me-memories.controller';
import { ChatTodosController } from './chat-todos.controller';
import { SharedChatsController } from './shared-chats.controller';
import { MePromptsController } from './me-prompts.controller';
import { MeUsageController } from './me-usage.controller';
import { ConfigResolverModule } from '../config-resolver/config-resolver.module';

// HTTP endpoints are safe to expose only because SessionAuthGuard derives the tenant
// identity from a verified session. Controllers must never accept ownerUserId from
// client input; that would recreate the #61 tenant-impersonation IDOR.
//
// Boundary: chats owns the turn (validate, persist message + run, supersede);
// everything run-execution-shaped comes from RunWorkerModule (dispatch seam +
// stream bridge) and RunsModule (abort registry) — chats knows nothing about
// queues, workers, compaction, titling, or the policy engine (that's
// RunWorkerModule/RunExecutionService's concern, for tool-loop gating).
@Module({
  imports: [
    AuthModule,
    ModelsModule,
    RunsModule,
    RunWorkerModule,
    ConfigResolverModule,
  ],
  controllers: [
    ChatsController,
    MeMemoriesController,
    ChatTodosController,
    SharedChatsController,
    MePromptsController,
    MeUsageController,
  ],
  providers: [ChatsService, ChatLoopService],
  exports: [ChatsService],
})
export class ChatsModule {}
