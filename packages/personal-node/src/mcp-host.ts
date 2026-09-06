import {
  containsProtectedValueJson,
  type ToolResult,
  type UnknownRecord,
} from "@workspace/runtime-safety";
import { createMcpToolId } from "@workspace/tool-runtime/tool-id";
import { type McpServer } from "./mcp-config";
import { type Approval, type ToolDefinition } from "./types";
import { aborted, CliError } from "./errors";
import { jsonValue, type JsonValue } from "./validation";

/** Narrow execution port; the default implementation wraps the shared node client. */
export interface ConnectedMcpTool {
  readonly id: string;
  readonly remoteName: string;
  readonly description: string;
  readonly inputSchema: UnknownRecord;
  validate(args: JsonValue): boolean;
  execute(
    args: JsonValue,
    id: string,
    signal: AbortSignal,
  ): Promise<{ result: ToolResult; disconnected: boolean }>;
}
export interface McpConnection {
  discover(signal: AbortSignal): Promise<{
    tools: ReadonlyArray<ConnectedMcpTool>;
    refused: ReadonlyArray<{ id?: string; reason: string }>;
  }>;
  close(): Promise<void>;
}
export type McpConnector = (
  server: McpServer,
  ...rest: [
    protectedValues: ReadonlyArray<string>,
    env: NodeJS.ProcessEnv,
    signal: AbortSignal,
    disconnected: () => void,
  ]
) => Promise<McpConnection>;
export type ToolAudit = (type: string, payload: UnknownRecord) => void;

interface BoundTool {
  tool: ConnectedMcpTool;
  server: McpServer;
}

export class McpHost {
  private readonly connections: Array<McpConnection> = [];
  private readonly bound = new Map<string, BoundTool>();
  private readonly disconnected = new Set<string>();
  readonly catalog: Array<ToolDefinition> = [];
  readonly availability: Array<{ id: string; state: string; reason?: string }> =
    [];

  private constructor(
    private readonly protectedValues: ReadonlyArray<string>,
  ) {}

  static async connect(
    servers: ReadonlyArray<McpServer>,
    protectedValues: ReadonlyArray<string>,
    env: NodeJS.ProcessEnv,
    ...rest: [signal: AbortSignal, connector?: McpConnector]
  ): Promise<McpHost> {
    const [signal, connector] = rest;
    const host = new McpHost(protectedValues);
    if (!servers.length) return host;
    try {
      await host.discoverAll(servers, env, signal, connector);
      return host;
    } catch (error) {
      await host.close();
      throw error instanceof CliError
        ? error
        : new CliError(
            "mcp_connection",
            "MCP connection or declaration discovery failed. No model request was sent; check transport, credentials and server availability.",
          );
    }
  }

  private async discoverAll(
    servers: ReadonlyArray<McpServer>,
    env: NodeJS.ProcessEnv,
    signal: AbortSignal,
    connector?: McpConnector,
  ): Promise<void> {
    const connect =
      connector ?? (await import("./mcp-connection.js")).connectMcp;
    for (const server of servers) {
      aborted(signal);
      await this.discoverServer(server, env, signal, connect);
    }
    if (this.disconnected.size)
      throw new CliError(
        "mcp_disconnected",
        "An MCP server disconnected during discovery; no Run was started.",
      );
  }

  private async discoverServer(
    server: McpServer,
    env: NodeJS.ProcessEnv,
    signal: AbortSignal,
    connect: McpConnector,
  ): Promise<void> {
    const connection = await connect(
      server,
      this.protectedValues,
      env,
      signal,
      () => this.disconnected.add(server.id),
    );
    this.connections.push(connection);
    const discovered = await connection.discover(signal);
    for (const refused of discovered.refused)
      this.availability.push({
        id: refused.id ?? server.id,
        state: "unavailable",
        reason: refused.reason,
      });
    for (const tool of discovered.tools) this.admit(server, tool);
    this.noteMissing(server, discovered.tools);
  }

  private noteMissing(
    server: McpServer,
    tools: ReadonlyArray<ConnectedMcpTool>,
  ): void {
    for (const name of server.allowTools ?? []) {
      if (tools.some((tool) => tool.remoteName === name)) continue;
      const mapped = createMcpToolId(server.id, name);
      this.availability.push({
        id: mapped.success ? mapped.id : server.id,
        state: "unavailable",
        reason: "tool_missing_or_refused",
      });
    }
  }

  private admit(server: McpServer, tool: ConnectedMcpTool): void {
    if (server.allowTools && !server.allowTools.includes(tool.remoteName))
      return;
    if (this.protectedDeclaration(server, tool)) return;
    if (this.bound.has(tool.id))
      throw new CliError(
        "mcp_collision",
        "MCP tool identifiers collide; no catalog was activated.",
      );
    if (this.catalog.length >= 128)
      throw new CliError(
        "mcp_catalog_limit",
        "At most 128 MCP tools may be offered. Restrict servers with allowTools.",
      );
    this.bound.set(tool.id, { tool, server });
    this.catalog.push({
      type: "function",
      function: {
        name: tool.id,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    });
    this.availability.push({ id: tool.id, state: "available" });
  }

  private protectedDeclaration(
    server: McpServer,
    tool: ConnectedMcpTool,
  ): boolean {
    if (
      !containsProtectedValueJson(
        {
          id: tool.id,
          description: tool.description,
          schema: tool.inputSchema,
        },
        this.protectedValues,
      )
    ) {
      return false;
    }
    this.availability.push({
      id: server.id,
      state: "unavailable",
      reason: "protected_value",
    });
    return true;
  }

  has(name: string): boolean {
    return this.bound.has(name);
  }

  async execute(
    name: string,
    args: JsonValue,
    callId: string,
    ...rest: [signal: AbortSignal, approve: Approval, audit: ToolAudit]
  ): Promise<ToolResult> {
    return this.runCall(name, args, callId, rest);
  }

  private async runCall(
    name: string,
    args: JsonValue,
    callId: string,
    rest: [AbortSignal, Approval, ToolAudit],
  ): Promise<ToolResult> {
    const entry = this.bound.get(name);
    if (!entry)
      throw new CliError(
        "tool_unavailable",
        "MCP tool is not in this Run’s admitted catalog.",
      );
    const parsed = jsonValue(args);
    this.guardArgs(entry, parsed);
    const approvalSignal = rest[0];
    aborted(approvalSignal);
    if (this.disconnected.has(entry.server.id))
      throw new CliError(
        "mcp_disconnected",
        "MCP server disconnected. This Run will not reconnect or replay calls.",
      );
    await this.confirm(name, parsed, callId, [entry, approvalSignal, rest]);
    const callSignal = AbortSignal.any([
      rest[0],
      AbortSignal.timeout(entry.server.callTimeoutSeconds * 1000),
    ]);
    aborted(callSignal);
    return this.callTool(name, parsed, callId, [entry, callSignal, rest[2]]);
  }

  private guardArgs(entry: BoundTool, parsed: JsonValue): void {
    if (containsProtectedValueJson(parsed, this.protectedValues))
      throw new CliError(
        "protected_argument",
        "MCP arguments contain a configured credential.",
      );
    if (!entry.tool.validate(parsed))
      throw new CliError(
        "invalid_tool_arguments",
        "MCP arguments do not satisfy the admitted JSON Schema.",
      );
  }

  private async confirm(
    name: string,
    parsed: JsonValue,
    callId: string,
    ctx: [BoundTool, AbortSignal, [AbortSignal, Approval, ToolAudit]],
  ): Promise<void> {
    const [entry, callSignal, rest] = ctx;
    const automatic = entry.server.autoApprove.includes(entry.tool.remoteName);
    const audit = rest[2];
    audit("tool.approval_requested", {
      id: callId,
      name,
      server: entry.server.id,
      source: automatic ? "configuration" : "terminal",
      arguments: parsed,
    });
    const approved =
      automatic ||
      (await rest[1](
        `MCP ${name}\nArguments: ${JSON.stringify(parsed)}\nServer annotations do not establish safety. Allow this invocation?`,
        callSignal,
      ));
    audit("tool.approval_decided", {
      id: callId,
      name,
      approved,
      source: automatic ? "configuration" : "terminal",
    });
    if (!approved)
      throw new CliError(
        "approval_denied",
        "MCP tool invocation was not approved.",
      );
    aborted(callSignal);
    if (this.disconnected.has(entry.server.id))
      throw new CliError(
        "mcp_disconnected",
        "MCP server disconnected while approval was pending.",
      );
  }

  private async callTool(
    name: string,
    parsed: JsonValue,
    callId: string,
    ctx: [BoundTool, AbortSignal, ToolAudit],
  ): Promise<ToolResult> {
    const [entry, callSignal, audit] = ctx;
    audit("tool.started", { id: callId, name, server: entry.server.id });
    try {
      const outcome = await entry.tool.execute(parsed, callId, callSignal);
      if (outcome.disconnected) this.disconnected.add(entry.server.id);
      return outcome.result;
    } catch {
      this.disconnected.add(entry.server.id);
      throw new CliError(
        callSignal.aborted ? "mcp_timeout" : "mcp_call_failed",
        "MCP call failed or was interrupted. Its side effect may have occurred. Nothing was retried; inspect the service before repeating it.",
      );
    }
  }

  async close(): Promise<void> {
    const connections = this.connections.splice(0);
    await Promise.allSettled(
      connections.map((connection) => connection.close()),
    );
  }
}
