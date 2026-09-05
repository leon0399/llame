import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { McpRuntimeModule } from '../mcp/mcp-runtime.module';
import { MemoryModule } from '../memory/memory.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ModelsModule } from '../models/models.module';
import { PersonalizationModule } from '../personalization/personalization.module';
import { RunWorkerModule } from '../runs/run-worker.module';
import { RunsModule } from '../runs/runs.module';
import { SearchModule } from '../search/search.module';
import { SystemPromptsModule } from '../system-prompts/system-prompts.module';
import { ChatLoopService } from './chat-loop.service';
import { RecencyDigestModule } from './recency-digest.module';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import { MeRunsController } from './me-runs.controller';
import { SharedChatsController } from './shared-chats.controller';

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
    SystemPromptsModule,
    AuthModule,
    ModelsModule,
    PersonalizationModule,
    RunsModule,
    RunWorkerModule,
    SearchModule,
    McpRuntimeModule,
    MemoryModule,
    KnowledgeModule,
    RecencyDigestModule,
  ],
  controllers: [ChatsController, MeRunsController, SharedChatsController],
  providers: [ChatsService, ChatLoopService],
  exports: [ChatsService, ChatLoopService],
})
export class ChatsModule {}
