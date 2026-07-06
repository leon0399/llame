import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ModelsModule } from '../models/models.module';
import { RunWorkerModule } from '../runs/run-worker.module';
import { RunsModule } from '../runs/runs.module';
import { ConfigResolverModule } from '../config-resolver/config-resolver.module';
import { ChatLoopService } from './chat-loop.service';
import { ChatTodosController } from './chat-todos.controller';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';

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
  controllers: [ChatsController, ChatTodosController],
  providers: [ChatsService, ChatLoopService],
  exports: [ChatsService],
})
export class ChatsModule {}
