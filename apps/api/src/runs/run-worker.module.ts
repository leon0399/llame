import { Module } from '@nestjs/common';
import { CompactionModule } from '../compaction/compaction.module';
import { McpRuntimeModule } from '../mcp/mcp-runtime.module';
import { McpRuntimeService } from '../mcp/mcp-runtime.service';
import { ModelsModule } from '../models/models.module';
import { QueueModule } from '../queue/queue.module';
import { SearchModule } from '../search/search.module';
import { TitlesModule } from '../titles/titles.module';
import { RunDispatchService } from './run-dispatch.service';
import { RunExecutionService } from './run-execution.service';
import { RunStreamBridgeService } from './run-stream-bridge';
import { RunsModule } from './runs.module';
import { RunsWorkerService } from './runs-worker.service';
import { DYNAMIC_TOOL_EXECUTOR_RESOLVER } from './snapshot-tool-execution';

/**
 * RunWorkerModule (#48/#50) — the run EXECUTION side: queue consumers
 * (RunsWorkerService), the transport-agnostic executor, the publish seam
 * (RunDispatchService), and the run-event → UI stream bridge. This is the
 * module the dedicated worker entrypoint (#116) boots; the api process
 * imports it too while consumers are co-located (v0.2).
 *
 * Boundary rule: everything queue-shaped lives HERE — callers dispatch runs
 * and read the bridge, and never see queue names or payloads.
 */
@Module({
  imports: [
    QueueModule,
    ModelsModule,
    CompactionModule,
    TitlesModule,
    RunsModule,
    SearchModule,
    McpRuntimeModule,
  ],
  providers: [
    RunExecutionService,
    RunsWorkerService,
    RunStreamBridgeService,
    RunDispatchService,
    {
      provide: DYNAMIC_TOOL_EXECUTOR_RESOLVER,
      useExisting: McpRuntimeService,
    },
  ],
  exports: [RunDispatchService, RunStreamBridgeService],
})
export class RunWorkerModule {}
