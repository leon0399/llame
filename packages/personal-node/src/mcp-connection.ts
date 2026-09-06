import { isString } from "@workspace/runtime-safety";
import {
  McpServerClient,
  type McpDiscoveredTool,
} from "@workspace/tool-runtime/mcp-server-client";
import { compileJsonSchemaValidator } from "@workspace/tool-runtime/schema-utils";
import { CliError } from "./errors";
import { type McpConnector, type ConnectedMcpTool } from "./mcp-host";
import { type JsonValue } from "./validation";

/** No Nest service or node database dependency crosses this client boundary. */
export const connectMcp: McpConnector = async (server, ...rest) => {
  const [protectedValues, env, signal, onDisconnect] = rest;
  const shared = { serverId: server.id, signal, onDisconnect };
  const client =
    server.transport === "http"
      ? await McpServerClient.connect({
          ...shared,
          url: server.url,
          headers: server.headers,
        })
      : await McpServerClient.connectStdio({
          ...shared,
          command: server.command,
          args: server.args,
          cwd: server.cwd,
          env: stdioEnv(env, server.env),
          inheritEnvironment: false,
          protectedValues,
        });
  return {
    close: () => client.close(),
    discover: async (signal) => {
      const discovered = await client.discover({ signal });
      return {
        tools: discovered.tools.map(boundTool),
        refused: discovered.refused,
      };
    },
  };
};

function stdioEnv(
  env: NodeJS.ProcessEnv,
  extra: Readonly<Record<string, string>>,
) {
  return {
    ...Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] =>
        isString(entry[1]),
      ),
    ),
    ...extra,
  };
}

function boundTool({
  definition,
  execute,
}: McpDiscoveredTool): ConnectedMcpTool {
  const validator = compileJsonSchemaValidator(definition.inputSchema);
  if (!validator.success)
    throw new CliError(
      "mcp_schema",
      "A previously admitted MCP schema no longer compiles.",
    );
  return {
    ...definition,
    validate: (args: JsonValue) => validator.validate(args).success,
    execute: async (args, id, abortSignal) => {
      const outcome = await execute(args, {
        toolCallId: id,
        messages: [],
        abortSignal,
      });
      return {
        result: outcome.result,
        disconnected: outcome.disposition === "reconnect",
      };
    },
  };
}
