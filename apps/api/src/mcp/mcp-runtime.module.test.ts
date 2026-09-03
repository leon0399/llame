import { Test } from '@nestjs/testing';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { ChatsModule } from '../chats/chats.module';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { RunWorkerModule } from '../runs/run-worker.module';
import { DYNAMIC_TOOL_EXECUTOR_RESOLVER } from '../runs/snapshot-tool-execution';
import {
  EMPTY_MCP_RUNTIME_SERVER_DEFINITIONS,
  MCP_RUNTIME_SERVER_DEFINITIONS,
  McpRuntimeModule,
} from './mcp-runtime.module';
import { McpRuntimeService } from './mcp-runtime.service';

describe('McpRuntimeModule', () => {
  it('keeps the default production runtime inert over the frozen empty definition map', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [McpRuntimeModule],
    })
      .overrideProvider(InstanceConfigService)
      .useValue({
        config: { ...BUILT_IN_DEFAULTS, mcpServers: {} },
      })
      .compile();

    const definitions = moduleRef.get<
      typeof EMPTY_MCP_RUNTIME_SERVER_DEFINITIONS
    >(MCP_RUNTIME_SERVER_DEFINITIONS);
    const runtime = moduleRef.get(McpRuntimeService);

    expect(definitions).toBe(EMPTY_MCP_RUNTIME_SERVER_DEFINITIONS);
    expect(Object.isFrozen(definitions)).toBe(true);

    await moduleRef.init();
    expect(runtime.snapshotCandidates()).toEqual([]);
    await moduleRef.close();
  });

  it('projects only resolved url and headers from private instance configuration', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [McpRuntimeModule],
    })
      .overrideProvider(InstanceConfigService)
      .useValue({
        config: {
          ...BUILT_IN_DEFAULTS,
          mcpServers: {
            web: {
              type: 'streamable-http',
              url: 'https://mcp.example.test/rpc',
              headers: { authorization: 'Bearer resolved-sentinel' },
            },
          },
        },
      })
      .compile();

    const definitions = moduleRef.get<
      Readonly<
        Record<
          string,
          { readonly url: string; readonly headers?: Record<string, string> }
        >
      >
    >(MCP_RUNTIME_SERVER_DEFINITIONS);

    expect(definitions).toEqual({
      web: {
        url: 'https://mcp.example.test/rpc',
        headers: { authorization: 'Bearer resolved-sentinel' },
      },
    });
    expect(Object.isFrozen(definitions)).toBe(true);
    expect(JSON.stringify(definitions)).not.toContain('streamable-http');

    await moduleRef.close();
  });

  it('wires the same graph-local runtime into HTTP turn binding and worker execution', () => {
    const chatImports: unknown = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      ChatsModule,
    );
    const workerImports: unknown = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      RunWorkerModule,
    );
    const workerProviders: unknown = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      RunWorkerModule,
    );

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
    })
      .overrideProvider(InstanceConfigService)
      .useValue({ config: { ...BUILT_IN_DEFAULTS, mcpServers: {} } })
      .compile();
    const secondGraph = await Test.createTestingModule({
      imports: [McpRuntimeModule],
    })
      .overrideProvider(InstanceConfigService)
      .useValue({ config: { ...BUILT_IN_DEFAULTS, mcpServers: {} } })
      .compile();

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
