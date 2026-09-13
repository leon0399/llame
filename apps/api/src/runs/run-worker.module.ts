import { Module } from '@nestjs/common';
import { CompactionModule } from '../compaction/compaction.module';
import { RecencyDigestModule } from '../chats/recency-digest.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { McpRuntimeModule } from '../mcp/mcp-runtime.module';
import { McpRuntimeService } from '../mcp/mcp-runtime.service';
import { MemoryModule } from '../memory/memory.module';
import { ModelsModule } from '../models/models.module';
import { PersonalizationModule } from '../personalization/personalization.module';
import { QueueModule } from '../queue/queue.module';
import { SearchModule } from '../search/search.module';
import { SkillsModule } from '../skills/skills.module';
import { SystemPromptsModule } from '../system-prompts/system-prompts.module';
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
 * Prompt rendering, tool-catalog composition, and context-item derivation
 * happen here at execution time — SystemPromptsModule, PersonalizationModule,
 * MemoryModule, RecencyDigestModule, and McpRuntimeModule provide the services
 * RunExecutionService needs.
 *
 * Boundary rule: everything queue-shaped lives HERE — callers dispatch runs
 * and read the bridge, and never see queue names or payloads.
 */
@Module({
  imports: [
    QueueModule,
    ModelsModule,
    CompactionModule,
    KnowledgeModule,
    SkillsModule,
    TitlesModule,
    RunsModule,
    SearchModule,
    McpRuntimeModule,
    SystemPromptsModule,
    PersonalizationModule,
    MemoryModule,
    RecencyDigestModule,
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
