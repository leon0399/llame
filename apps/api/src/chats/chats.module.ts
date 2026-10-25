import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MachinesModule } from '../machines/machines.module';
import { MediaModule } from '../media/media.module';
import { ModelsModule } from '../models/models.module';
import { ProjectsModule } from '../projects/projects.module';
import { RunWorkerModule } from '../runs/run-worker.module';
import { RunsModule } from '../runs/runs.module';
import { SearchModule } from '../search/search.module';
import { ChatCreationLock } from './chat-creation-lock';
import { ChatCreationController } from './chat-creation.controller';
import { ChatCreationService } from './chat-creation.service';
import { ChatCreationWorkspace } from './chat-creation-workspace';
import { ChatLoopService } from './chat-loop.service';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import { MeRunsController } from './me-runs.controller';
import { SharedChatsController } from './shared-chats.controller';

// HTTP endpoints are safe to expose only because SessionAuthGuard derives the tenant
// identity from a verified session. Controllers must never accept ownerUserId from
// client input; that would recreate the #61 tenant-impersonation IDOR.
//
// Boundary: chats owns the turn (validate, persist message + run); everything
// run-execution-shaped — prompt rendering, tool-catalog composition, context-item
// derivation, compaction, titling, and the policy engine — comes from
// RunWorkerModule and runs at execution time.
@Module({
  imports: [
    AuthModule,
    MachinesModule,
    MediaModule,
    ModelsModule,
    ProjectsModule,
    RunsModule,
    RunWorkerModule,
    SearchModule,
  ],
  controllers: [
    ChatsController,
    ChatCreationController,
    MeRunsController,
    SharedChatsController,
  ],
  providers: [
    ChatsService,
    ChatLoopService,
    ChatCreationLock,
    ChatCreationService,
    ChatCreationWorkspace,
  ],
  exports: [ChatsService],
})
export class ChatsModule {}
