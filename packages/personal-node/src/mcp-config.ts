import { dirname, isAbsolute } from 'node:path';
import { interpolateStringWithSubstitutions } from '@workspace/config-interpolation';
import { isBoolean, type UnknownRecord } from '@workspace/runtime-safety';
import { CliError } from './errors';
import { authority, integer, keys, record, text } from './validation';

interface McpPolicy {
  readonly id: string;
  readonly allowTools?: readonly string[];
  readonly autoApprove: readonly string[];
  readonly callTimeoutSeconds: number;
}
export type McpServer = McpPolicy & (
  | { readonly transport: 'http'; readonly url: string; readonly headers: Readonly<Record<string, string>> }
  | { readonly transport: 'stdio'; readonly command: string; readonly args: readonly string[];
      readonly env: Readonly<Record<string, string>>; readonly cwd: string }
);

const allowedKeys = ['enabled', 'transport', 'url', 'headers', 'command', 'args', 'env', 'cwd', 'allowTools', 'autoApprove', 'callTimeoutSeconds'];
const reservedHeaders = /^(?:host|cookie|origin|content-length|content-type|accept|connection|transfer-encoding|mcp-session-id|mcp-protocol-version|last-event-id)$/iu;

export function mcpEntries(value: unknown): [string, UnknownRecord][] {
  if (value === undefined) return [];
  const entries = Object.entries(record(value, 'mcp'));
  if (entries.length > 16) throw new CliError('mcp_limit', 'Configure at most 16 MCP servers.');
  return entries.map(([id, raw]) => {
    if (!/^[a-z][a-z0-9_-]{0,31}$/u.test(id) || id.includes('__')) throw new CliError('mcp_id', 'MCP server IDs must be 1–32 lowercase ASCII letters, digits, underscores or hyphens, starting with a letter; double underscores are reserved.');
    const server = record(raw, 'MCP server'); keys(server, allowedKeys, 'MCP server');
    if (!isBoolean(server.enabled)) throw new CliError('mcp_enabled', 'Each MCP server needs an explicit enabled boolean.');
    if (server.transport !== 'http' && server.transport !== 'stdio') throw new CliError('mcp_transport', 'Use http (Streamable HTTP) or stdio.');
    return [id, server];
  });
}

function strings(value: unknown, label: string, maximum = 128): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new CliError('mcp_config', `${label} must be an array of at most ${maximum} strings.`);
  const result = value.map(entry => text(entry, label, 8192));
  if (new Set(result).size !== result.length && label !== 'args') throw new CliError('mcp_config', `${label} must not contain duplicates.`);
  return result;
}

function resolveValue(value: unknown, env: NodeJS.ProcessEnv, secrets: string[]): string {
  const source = text(value, 'MCP credential/environment value', 8192);
  const result = interpolateStringWithSubstitutions(source, env);
  secrets.push(...result.substituted);
  return result.value;
}

function stringMap(value: unknown, env: NodeJS.ProcessEnv, secrets: string[], header: boolean): Record<string, string> {
  if (value === undefined) return {};
  const entries = Object.entries(record(value, header ? 'headers' : 'env'));
  if (entries.length > 64) throw new CliError('mcp_config', 'At most 64 explicit headers or environment variables per MCP server.');
  const names = new Set<string>();
  return Object.fromEntries(entries.map(([key, raw]) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/u.test(key) || (header && reservedHeaders.test(key))) {
      throw new CliError('mcp_config', 'Invalid or reserved MCP header/environment name.');
    }
    const normalized = header ? key.toLowerCase() : key;
    if (names.has(normalized)) throw new CliError('mcp_config', 'Duplicate MCP header name.');
    names.add(normalized);
    const resolved = resolveValue(raw, env, secrets);
    if (resolved.includes('\0') || (header && /[\r\n]/u.test(resolved))) throw new CliError('mcp_config', 'Invalid control character in MCP credential/environment value.');
    // Header values are credentials even when authored literally. Environment
    // literals may be low-entropy switches; substitutions are always protected.
    if (header || /(?:token|secret|password|credential|api[_-]?key|private[_-]?key)/iu.test(key)) {
      secrets.push(resolved);
      if (/^(?:Bearer|Basic) /iu.test(resolved)) secrets.push(resolved.slice(resolved.indexOf(' ') + 1));
    }
    return [key, resolved];
  }));
}

export function parseMcpServers(value: unknown, env: NodeJS.ProcessEnv, path: string, secrets: string[], selected?: string): McpServer[] {
  const entries = mcpEntries(value);
  if (selected && !entries.some(([id]) => id === selected)) throw new CliError('mcp_unknown', 'Unknown MCP server ID.');
  if (selected && !entries.some(([id, item]) => id === selected && item.enabled)) throw new CliError('mcp_disabled', 'Enable that MCP server before connecting.');
  return entries.filter(([id, item]) => item.enabled && (!selected || selected === id)).map(([id, item]) => {
    const allowTools = item.allowTools === undefined ? undefined : strings(item.allowTools, 'allowTools');
    const autoApprove = item.autoApprove === undefined ? [] : strings(item.autoApprove, 'autoApprove');
    if (allowTools && autoApprove.some(name => !allowTools.includes(name))) throw new CliError('mcp_policy', 'autoApprove must be a subset of allowTools when an allowlist is present.');
    const policy: McpPolicy = { id, allowTools, autoApprove,
      callTimeoutSeconds: integer(item.callTimeoutSeconds ?? 30, 'MCP callTimeoutSeconds', 1, 300) };
    if (item.transport === 'http') {
      keys(item, ['enabled', 'transport', 'url', 'headers', 'allowTools', 'autoApprove', 'callTimeoutSeconds'], 'HTTP MCP server');
      const url = text(item.url, 'MCP URL', 2048); authority(url);
      return { ...policy, transport: 'http', url: new URL(url).href, headers: stringMap(item.headers, env, secrets, true) };
    }
    keys(item, ['enabled', 'transport', 'command', 'args', 'env', 'cwd', 'allowTools', 'autoApprove', 'callTimeoutSeconds'], 'stdio MCP server');
    const command = text(item.command, 'MCP command', 2048);
    if (command.includes('\0') || /\{(?:env|path):/u.test(command)) throw new CliError('mcp_command', 'MCP command must be literal; supply credentials through env, never the executable name.');
    const cwd = item.cwd === undefined ? dirname(path) : text(item.cwd, 'MCP cwd', 4096);
    if (!isAbsolute(cwd)) throw new CliError('mcp_cwd', 'MCP cwd must be an absolute path. It defaults to the config directory.');
    const args = strings(item.args ?? [], 'args');
    if (args.some(arg => arg.includes('\0') || /\{(?:env|path):/u.test(arg))) {
      throw new CliError('mcp_config', 'MCP arguments must be literal and may not contain NUL. Put credential references in env, not process arguments.');
    }
    return { ...policy, transport: 'stdio', command, args, cwd, env: stringMap(item.env, env, secrets, false) };
  });
}
