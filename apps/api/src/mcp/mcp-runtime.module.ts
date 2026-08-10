import { Module } from '@nestjs/common';

import {
  McpRuntimeService,
  type McpRuntimeServerDefinition,
} from './mcp-runtime.service';

export const MCP_RUNTIME_SERVER_DEFINITIONS = Symbol(
  'MCP_RUNTIME_SERVER_DEFINITIONS',
);

export const EMPTY_MCP_RUNTIME_SERVER_DEFINITIONS: Readonly<
  Record<string, McpRuntimeServerDefinition>
> = Object.freeze({});

@Module({
  providers: [
    {
      provide: MCP_RUNTIME_SERVER_DEFINITIONS,
      useValue: EMPTY_MCP_RUNTIME_SERVER_DEFINITIONS,
    },
    {
      provide: McpRuntimeService,
      useFactory: (
        servers: Readonly<Record<string, McpRuntimeServerDefinition>>,
      ) => new McpRuntimeService(servers),
      inject: [MCP_RUNTIME_SERVER_DEFINITIONS],
    },
  ],
  exports: [MCP_RUNTIME_SERVER_DEFINITIONS, McpRuntimeService],
})
export class McpRuntimeModule {}
