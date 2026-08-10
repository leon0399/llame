import { Test } from '@nestjs/testing';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { ChatsModule } from '../chats/chats.module';
import { RunWorkerModule } from '../runs/run-worker.module';
import { DYNAMIC_TOOL_EXECUTOR_RESOLVER } from '../runs/snapshot-tool-execution';
import {
  EMPTY_MCP_RUNTIME_SERVER_DEFINITIONS,
  MCP_RUNTIME_SERVER_DEFINITIONS,
  McpRuntimeModule,
} from './mcp-runtime.module';
import { McpRuntimeService } from './mcp-runtime.service';

describe('McpRuntimeModule', () => {
  it('provides one inert runtime over the frozen empty production definition map', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [McpRuntimeModule],
    }).compile();

    const definitions = moduleRef.get<
      typeof EMPTY_MCP_RUNTIME_SERVER_DEFINITIONS
    >(MCP_RUNTIME_SERVER_DEFINITIONS);
    const runtime = moduleRef.get(McpRuntimeService);

    expect(definitions).toBe(EMPTY_MCP_RUNTIME_SERVER_DEFINITIONS);
    expect(Object.isFrozen(definitions)).toBe(true);

    await moduleRef.init();
    expect(runtime.snapshotCandidates(new Set(['mcp__web__search']))).toEqual(
      [],
    );
    await moduleRef.close();
  });

  it('wires the same graph-local runtime into HTTP turn binding and worker execution', () => {
    const chatImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      ChatsModule,
    ) as readonly unknown[];
    const workerImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      RunWorkerModule,
    ) as readonly unknown[];
    const workerProviders = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      RunWorkerModule,
    ) as readonly unknown[];

    expect(chatImports).toContain(McpRuntimeModule);
    expect(workerImports).toContain(McpRuntimeModule);
    expect(workerProviders).toContainEqual({
      provide: DYNAMIC_TOOL_EXECUTOR_RESOLVER,
      useExisting: McpRuntimeService,
    });
  });

  it('creates one runtime per Nest application graph', async () => {
    const firstGraph = await Test.createTestingModule({
      imports: [McpRuntimeModule, McpRuntimeModule],
    }).compile();
    const secondGraph = await Test.createTestingModule({
      imports: [McpRuntimeModule],
    }).compile();

    expect(firstGraph.get(McpRuntimeService)).toBe(
      firstGraph.get(McpRuntimeService),
    );
    expect(firstGraph.get(McpRuntimeService)).not.toBe(
      secondGraph.get(McpRuntimeService),
    );

    await firstGraph.close();
    await secondGraph.close();
  });
});
