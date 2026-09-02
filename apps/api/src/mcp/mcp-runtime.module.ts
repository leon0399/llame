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
import { type MutableStdioDefinition } from './mcp-runtime-definition';

export const MCP_RUNTIME_SERVER_DEFINITIONS = Symbol(
  'MCP_RUNTIME_SERVER_DEFINITIONS',
);

export const EMPTY_MCP_RUNTIME_SERVER_DEFINITIONS: Readonly<
  Record<string, McpRuntimeServerDefinition>
> = Object.freeze({});

type MutableRemoteDefinition = {
  url: string;
  headers?: Readonly<Record<string, string>>;
};

function runtimeDefinitionFor(
  definition: InstanceConfigReader['config']['mcpServers'][string],
): McpRuntimeServerDefinition {
  if (definition.type === 'stdio') {
    const stdio: MutableStdioDefinition = {
      transport: 'stdio',
      command: definition.command,
    };
    // Passed by reference: the config loader already froze these, so
    // copying to re-freeze buys nothing.
    if (definition.args !== undefined) stdio.args = definition.args;
    if (definition.env !== undefined) stdio.env = definition.env;
    if (definition.cwd !== undefined) stdio.cwd = definition.cwd;
    if (definition.protectedValues !== undefined) {
      stdio.protectedValues = definition.protectedValues;
    }
    return stdio;
  }

  const remote: MutableRemoteDefinition = {
    url: definition.url,
  };
  if (definition.headers !== undefined) {
    remote.headers = Object.freeze({ ...definition.headers });
  }
  return remote;
}

function runtimeServerDefinitions(
  instanceConfig: InstanceConfigReader,
): Readonly<Record<string, McpRuntimeServerDefinition>> {
  const entries = Object.entries(instanceConfig.config.mcpServers);
  if (entries.length === 0) return EMPTY_MCP_RUNTIME_SERVER_DEFINITIONS;

  return Object.freeze(
    Object.fromEntries(
      entries.map(([serverId, definition]) => [
        serverId,
        Object.freeze(runtimeDefinitionFor(definition)),
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
