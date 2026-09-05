import { configDocument } from '@workspace/personal-node/config';
import { CliError } from '@workspace/personal-node/errors';
import { mcpEntries } from '@workspace/personal-node/mcp-config';
import { Output } from './output';
import { updatePrivate } from '@workspace/personal-node/private-files';
import { type Options } from './arguments';

export async function mcpCommand(options: Options, output: Output, discover: (id?: string) => Promise<unknown>): Promise<void> {
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
  output.value(await discover(id));
}
