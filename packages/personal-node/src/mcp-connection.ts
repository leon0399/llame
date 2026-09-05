import { isString } from '@workspace/runtime-safety';
import { McpServerClient } from '@workspace/tool-runtime/mcp-server-client';
import { compileJsonSchemaValidator } from '@workspace/tool-runtime/schema-utils';
import { CliError } from './errors';
import { type McpConnector, type ConnectedMcpTool } from './mcp-host';

/** No Nest service or node database dependency crosses this client boundary. */
export const connectMcp: McpConnector = async (server, protectedValues, env, signal, onDisconnect) => {
  const shared = { serverId: server.id, signal, onDisconnect };
  const client = server.transport === 'http'
    ? await McpServerClient.connect({ ...shared, url: server.url, headers: server.headers })
    : await McpServerClient.connectStdio({ ...shared, command: server.command, args: server.args,
        cwd: server.cwd, env: { ...Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => isString(entry[1]))), ...server.env }, inheritEnvironment: false, protectedValues });
  return {
    close: () => client.close(),
    discover: async signal => {
      const discovered = await client.discover({ signal });
      const tools: ConnectedMcpTool[] = discovered.tools.map(({ definition, execute }) => {
        const validator = compileJsonSchemaValidator(definition.inputSchema);
        if (!validator.success) throw new CliError('mcp_schema', 'A previously admitted MCP schema no longer compiles.');
        return {
          ...definition,
          validate: args => validator.validate(args).success,
          execute: async (args, id, abortSignal) => {
            const outcome = await execute(args, { toolCallId: id, messages: [], abortSignal });
            return { result: outcome.result, disconnected: outcome.disposition === 'reconnect' };
          },
        };
      });
      return { tools, refused: discovered.refused };
    },
  };
};
