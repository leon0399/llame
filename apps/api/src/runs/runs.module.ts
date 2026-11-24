import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ModelsModule } from '../models/models.module';
import { NextCandidateService } from './next-candidate.service';
import { RunAbortRegistry } from './run-abort-registry';
import { RunQueueModule } from './run-queue.module';
import { RunsController } from './runs.controller';

/**
 * RunsModule (#48/#49) — the run READ surface (run row + SSE event replay),
 * plus the owner's next-candidate action on a Run parked in a quota wait
 * (model-roles D7), which no worker can serve: the parked Run has no attempt.
 * Runs are written by the chat loop (ChatsModule) today and by the worker
 * after #50; this module deliberately owns only the read path and that action,
 * so it stays importable by any process that serves clients.
 */
@Module({
  imports: [AuthModule, ModelsModule, RunQueueModule],
  controllers: [RunsController],
  providers: [NextCandidateService, RunAbortRegistry],
  exports: [RunAbortRegistry],
})
export class RunsModule {}
