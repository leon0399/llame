import { containsProtectedValueJson, type ToolResult, type UnknownRecord } from '@workspace/runtime-safety';
import { createMcpToolId } from '@workspace/tool-runtime/tool-id';
import { type McpServer } from './mcp-config';
import { type Approval, type ToolDefinition } from './types';
import { aborted, CliError } from './errors';

/** Narrow execution port; the default implementation wraps the shared node client. */
export interface ConnectedMcpTool {
  readonly id: string;
  readonly remoteName: string;
  readonly description: string;
  readonly inputSchema: UnknownRecord;
  validate(args: unknown): boolean;
  execute(args: unknown, id: string, signal: AbortSignal): Promise<{ result: ToolResult; disconnected: boolean }>;
}
export interface McpConnection {
  discover(signal: AbortSignal): Promise<{ tools: readonly ConnectedMcpTool[]; refused: readonly { id?: string; reason: string }[] }>;
  close(): Promise<void>;
}
export type McpConnector = (server: McpServer, protectedValues: readonly string[], env: NodeJS.ProcessEnv,
  signal: AbortSignal, disconnected: () => void) => Promise<McpConnection>;
export type ToolAudit = (type: string, payload: UnknownRecord) => void;

interface BoundTool { tool: ConnectedMcpTool; server: McpServer }

export class McpHost {
  private readonly connections: McpConnection[] = [];
  private readonly bound = new Map<string, BoundTool>();
  private readonly disconnected = new Set<string>();
  readonly catalog: ToolDefinition[] = [];
  readonly availability: { id: string; state: string; reason?: string }[] = [];

  private constructor(private readonly protectedValues: readonly string[]) {}

  static async connect(servers: readonly McpServer[], protectedValues: readonly string[], env: NodeJS.ProcessEnv,
    signal: AbortSignal, connector?: McpConnector): Promise<McpHost> {
    const host = new McpHost(protectedValues);
    if (!servers.length) return host;
    try {
      const connect = connector ?? (await import('./mcp-connection.js')).connectMcp;
      for (const server of servers) {
        aborted(signal);
        const connection = await connect(server, protectedValues, env, signal, () => host.disconnected.add(server.id));
        host.connections.push(connection);
        const discovered = await connection.discover(signal);
        for (const refused of discovered.refused) host.availability.push({ id: refused.id ?? server.id, state: 'unavailable', reason: refused.reason });
        for (const tool of discovered.tools) host.admit(server, tool);
        for (const name of server.allowTools ?? []) {
          if (!discovered.tools.some(tool => tool.remoteName === name)) {
            const mapped = createMcpToolId(server.id, name);
            host.availability.push({ id: mapped.success ? mapped.id : server.id, state: 'unavailable', reason: 'tool_missing_or_refused' });
          }
        }
      }
      if (host.disconnected.size) throw new CliError('mcp_disconnected', 'An MCP server disconnected during discovery; no Run was started.');
      return host;
    } catch (error) { await host.close(); throw error instanceof CliError ? error : new CliError('mcp_connection', 'MCP connection or declaration discovery failed. No model request was sent; check transport, credentials and server availability.'); }
  }

  private admit(server: McpServer, tool: ConnectedMcpTool): void {
    if (server.allowTools && !server.allowTools.includes(tool.remoteName)) return;
    if (containsProtectedValueJson({ id: tool.id, description: tool.description, schema: tool.inputSchema }, this.protectedValues)) {
      this.availability.push({ id: server.id, state: 'unavailable', reason: 'protected_value' }); return;
    }
    if (this.bound.has(tool.id)) throw new CliError('mcp_collision', 'MCP tool identifiers collide; no catalog was activated.');
    if (this.catalog.length >= 128) throw new CliError('mcp_catalog_limit', 'At most 128 MCP tools may be offered. Restrict servers with allowTools.');
    this.bound.set(tool.id, { tool, server });
    this.catalog.push({ type: 'function', function: { name: tool.id, description: tool.description, parameters: tool.inputSchema } });
    this.availability.push({ id: tool.id, state: 'available' });
  }

  has(name: string): boolean { return this.bound.has(name); }

  async execute(name: string, args: unknown, callId: string, signal: AbortSignal, approve: Approval, audit: ToolAudit): Promise<ToolResult> {
    const entry = this.bound.get(name);
    if (!entry) throw new CliError('tool_unavailable', 'MCP tool is not in this Run’s admitted catalog.');
    const { tool, server } = entry;
    if (containsProtectedValueJson(args, this.protectedValues)) throw new CliError('protected_argument', 'MCP arguments contain a configured credential.');
    if (!tool.validate(args)) throw new CliError('invalid_tool_arguments', 'MCP arguments do not satisfy the admitted JSON Schema.');
    const callSignal = AbortSignal.any([signal, AbortSignal.timeout(server.callTimeoutSeconds * 1000)]);
    aborted(callSignal);
    if (this.disconnected.has(server.id)) throw new CliError('mcp_disconnected', 'MCP server disconnected. This Run will not reconnect or replay calls.');
    const automatic = server.autoApprove.includes(tool.remoteName);
    audit('tool.approval_requested', { id: callId, name, server: server.id, source: automatic ? 'configuration' : 'terminal', arguments: args });
    const approved = automatic || await approve(`MCP ${name}\nArguments: ${JSON.stringify(args)}\nServer annotations do not establish safety. Allow this invocation?`, callSignal);
    audit('tool.approval_decided', { id: callId, name, approved, source: automatic ? 'configuration' : 'terminal' });
    if (!approved) throw new CliError('approval_denied', 'MCP tool invocation was not approved.');
    aborted(callSignal);
    if (this.disconnected.has(server.id)) throw new CliError('mcp_disconnected', 'MCP server disconnected while approval was pending.');
    audit('tool.started', { id: callId, name, server: server.id });
    try {
      const outcome = await tool.execute(args, callId, callSignal);
      if (outcome.disconnected) this.disconnected.add(server.id);
      return outcome.result;
    } catch {
      this.disconnected.add(server.id);
      throw new CliError(callSignal.aborted ? 'mcp_timeout' : 'mcp_call_failed', 'MCP call failed or was interrupted. Its side effect may have occurred. Nothing was retried; inspect the service before repeating it.');
    }
  }

  async close(): Promise<void> {
    const connections = this.connections.splice(0);
    await Promise.allSettled(connections.map(connection => connection.close()));
  }
}
