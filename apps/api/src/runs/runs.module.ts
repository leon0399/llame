import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RunAbortRegistry } from './run-abort-registry';
import { RunsController } from './runs.controller';

/**
 * RunsModule (#48/#49) — the run READ surface (run row + SSE event replay).
 * Runs are written by the chat loop (ChatsModule) today and by the worker
 * after #50; this module deliberately owns only the read path, so it stays
 * importable by any process that serves clients.
 */
@Module({
  imports: [AuthModule],
  controllers: [RunsController],
  providers: [RunAbortRegistry],
  exports: [RunAbortRegistry],
})
export class RunsModule {}
