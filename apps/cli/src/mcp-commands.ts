import { normalizeProtectedValues } from '@workspace/runtime-safety';
import { configDocument } from './config';
import { commandEnvironment } from './env';
import { CliError } from './errors';
import { mcpEntries, parseMcpServers } from './mcp-config';
import { McpHost } from './mcp-host';
import { Output } from './output';
import { updatePrivate } from './private-files';
import { type Options } from './arguments';

export async function mcpCommand(options: Options, env: NodeJS.ProcessEnv, output: Output, signal: AbortSignal): Promise<void> {
  if (options.remote) throw new CliError('mode_conflict', 'mcp commands manage standalone connectors. Use --local mcp, or runs tools UUID to inspect node-managed tools.');
  const [, action = 'list', id, ...extra] = options.positionals;
  if (extra.length || (action === 'list' && id)) throw new CliError('arguments', 'Use mcp list, mcp enable/disable ID, or mcp tools [ID].');
  if (action === 'list') {
    output.value({ scope: 'local', servers: mcpEntries(configDocument(options.config).mcp)
      .map(([id, server]) => ({ id, enabled: server.enabled, transport: server.transport })) }); return;
  }
  if (action === 'enable' || action === 'disable') {
    if (!id) throw new CliError('arguments', 'Name the MCP server to enable or disable.');
    updatePrivate(options.config, () => {
      const document = configDocument(options.config); const entries = mcpEntries(document.mcp);
      if (!entries.some(([key]) => key === id)) throw new CliError('mcp_unknown', 'Add this MCP server definition to your user config first.');
      const mcp = Object.fromEntries(entries.map(([key, server]) => [key, key === id ? { ...server, enabled: action === 'enable' } : server]));
      return JSON.stringify({ ...document, mcp }, null, 2) + '\n';
    });
    output.value({ id, enabled: action === 'enable', scope: 'local' });
    output.notice('Saved. Enabling a stdio MCP authorizes launching its configured program on the next local Run/discovery; it is not a sandbox.'); return;
  }
  if (action !== 'tools') throw new CliError('command', 'Use mcp list, mcp enable/disable ID, or mcp tools [ID].');
  const secrets: string[] = [];
  const servers = parseMcpServers(configDocument(options.config).mcp, env, options.config, secrets, id);
  const protectedValues = normalizeProtectedValues(secrets); output.protect(protectedValues);
  const host = await McpHost.connect(servers, protectedValues, commandEnvironment(env), AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
  try { output.value({ scope: 'local', tools: host.catalog.map(tool => tool.function), availability: host.availability }); }
  finally { await host.close(); }
}
