import { Module } from '@nestjs/common';

import { InstanceConfigModule } from '../instance-config/instance-config.module';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
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

function runtimeServerDefinitions(
  instanceConfig: InstanceConfigReader,
): Readonly<Record<string, McpRuntimeServerDefinition>> {
  const entries = Object.entries(instanceConfig.config.mcpServers);
  if (entries.length === 0) return EMPTY_MCP_RUNTIME_SERVER_DEFINITIONS;

  return Object.freeze(
    Object.fromEntries(
      entries.map(([serverId, definition]) => [
        serverId,
        Object.freeze(
          definition.type === 'stdio'
            ? {
                transport: 'stdio' as const,
                command: definition.command,
                // Passed by reference: the config loader already froze these,
                // so copying to re-freeze buys nothing.
                ...(definition.args === undefined
                  ? {}
                  : { args: definition.args }),
                ...(definition.env === undefined
                  ? {}
                  : { env: definition.env }),
                ...(definition.cwd === undefined
                  ? {}
                  : { cwd: definition.cwd }),
                ...(definition.protectedValues === undefined
                  ? {}
                  : { protectedValues: definition.protectedValues }),
              }
            : {
                url: definition.url,
                ...(definition.headers === undefined
                  ? {}
                  : { headers: Object.freeze({ ...definition.headers }) }),
              },
        ),
      ]),
    ),
  );
}

@Module({
  imports: [InstanceConfigModule],
  providers: [
    {
      provide: MCP_RUNTIME_SERVER_DEFINITIONS,
      useFactory: runtimeServerDefinitions,
      inject: [InstanceConfigService],
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
