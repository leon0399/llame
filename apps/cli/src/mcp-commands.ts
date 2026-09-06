import { configDocument } from "@workspace/personal-node/config";
import { CliError } from "@workspace/personal-node/errors";
import { mcpEntries } from "@workspace/personal-node/mcp-config";
import { updatePrivate } from "@workspace/personal-node/private-files";
import { isString } from "@workspace/runtime-safety";
import { type Options } from "./arguments";
import { type DisplayValue, Output } from "./output";

export async function mcpCommand(
  options: Options,
  output: Output,
  discover: (id?: string) => Promise<DisplayValue>,
): Promise<void> {
  if (options.remote)
    throw new CliError(
      "mode_conflict",
      "mcp commands manage standalone connectors. Use --local mcp, or runs tools UUID to inspect node-managed tools.",
    );
  const [, action = "list", id, ...extra] = options.positionals;
  if (extra.length || (action === "list" && id !== undefined))
    throw new CliError(
      "arguments",
      "Use mcp list, mcp enable/disable ID, or mcp tools [ID].",
    );
  if (action === "list") {
    listMcp(options, output);
    return;
  }
  if (action === "enable" || action === "disable") {
    setMcpEnabled(options, output, action, id);
    return;
  }
  if (action !== "tools")
    throw new CliError(
      "command",
      "Use mcp list, mcp enable/disable ID, or mcp tools [ID].",
    );
  output.value(await discover(id));
}

function listMcp(options: Options, output: Output): void {
  output.value({
    scope: "local",
    servers: mcpEntries(configDocument(options.config).mcp).map(
      ([id, server]) => ({
        id,
        enabled: server.enabled,
        transport: server.transport,
      }),
    ),
  });
}

function setMcpEnabled(
  options: Options,
  output: Output,
  action: "enable" | "disable",
  id?: string,
): void {
  if (!id)
    throw new CliError(
      "arguments",
      "Name the MCP server to enable or disable.",
    );
  const transport = writeMcpEnabled(options.config, action, id);
  output.value({ id, enabled: action === "enable", scope: "local" });
  if (action === "enable" && transport === "stdio") {
    output.notice(
      "Saved. Enabling a stdio MCP authorizes launching its configured program on the next local Run/discovery; it is not a sandbox.",
    );
  }
}

function writeMcpEnabled(
  config: string,
  action: "enable" | "disable",
  id: string,
): string {
  let transport = "";
  updatePrivate(config, () => {
    const document = configDocument(config);
    const entries = mcpEntries(document.mcp);
    const target = entries.find(([key]) => key === id);
    if (!target)
      throw new CliError(
        "mcp_unknown",
        "Add this MCP server definition to your user config first.",
      );
    const raw = target[1].transport;
    if (!isString(raw))
      throw new CliError(
        "mcp_transport",
        "Use http (Streamable HTTP) or stdio.",
      );
    transport = raw;
    const mcp = Object.fromEntries(
      entries.map(([key, server]) => [
        key,
        key === id ? { ...server, enabled: action === "enable" } : server,
      ]),
    );
    return JSON.stringify({ ...document, mcp }, null, 2) + "\n";
  });
  return transport;
}
