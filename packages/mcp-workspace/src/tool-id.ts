const SERVER_ID = /^[A-Za-z0-9_-]+$/u;
const UNSAFE_TOOL_NAME_RUN = /[^A-Za-z0-9_-]+/gu;
const EDGE_UNDERSCORES = /^_+|_+$/gu;
const MAX_TOOL_ID_LENGTH = 64;
const MCP_TOOL_ID_PREFIX = 'mcp__';
const MCP_TOOL_ID_SEPARATOR = '__';

export type McpToolIdResult =
  | { success: true; id: string }
  | {
      success: false;
      reason: 'invalid_server_id' | 'empty_tool_name' | 'overlength';
    };

export type ParsedMcpToolIdResult =
  | { success: true; id: string; serverId: string; toolName: string }
  | {
      success: false;
      reason:
        | Extract<McpToolIdResult, { success: false }>['reason']
        | 'invalid_format'
        | 'noncanonical';
    };

function asciiCaseFold(value: string): string {
  return value.replaceAll(/[A-Z]/gu, (letter) => letter.toLowerCase());
}

export function createMcpToolId(
  serverId: string,
  remoteToolName: string,
): McpToolIdResult {
  if (!SERVER_ID.test(serverId) || serverId.includes('__')) {
    return { success: false, reason: 'invalid_server_id' };
  }

  const toolName = remoteToolName
    .normalize('NFKC')
    .replace(UNSAFE_TOOL_NAME_RUN, '_')
    .replace(EDGE_UNDERSCORES, '');
  if (toolName.length === 0) {
    return { success: false, reason: 'empty_tool_name' };
  }

  const id = `${MCP_TOOL_ID_PREFIX}${serverId}${MCP_TOOL_ID_SEPARATOR}${toolName}`;
  if (id.length > MAX_TOOL_ID_LENGTH) {
    return { success: false, reason: 'overlength' };
  }

  return { success: true, id };
}

/** Parse only ids that could have been emitted by `createMcpToolId`. */
export function parseMcpToolId(id: string): ParsedMcpToolIdResult {
  if (!id.startsWith(MCP_TOOL_ID_PREFIX)) {
    return { success: false, reason: 'invalid_format' };
  }
  const separatorIndex = id.indexOf(
    MCP_TOOL_ID_SEPARATOR,
    MCP_TOOL_ID_PREFIX.length,
  );
  if (separatorIndex === -1) {
    return { success: false, reason: 'invalid_format' };
  }

  const serverId = id.slice(MCP_TOOL_ID_PREFIX.length, separatorIndex);
  const toolName = id.slice(separatorIndex + MCP_TOOL_ID_SEPARATOR.length);
  const generated = createMcpToolId(serverId, toolName);
  if (!generated.success) return generated;
  if (generated.id !== id) {
    return { success: false, reason: 'noncanonical' };
  }
  return { success: true, id, serverId, toolName };
}

export function findAsciiCaseFoldedCollisionIndexes(
  ids: ReadonlyArray<string>,
): ReadonlySet<number> {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const folded = asciiCaseFold(id);
    counts.set(folded, (counts.get(folded) ?? 0) + 1);
  }

  const collisions = new Set<number>();
  ids.forEach((id, index) => {
    if ((counts.get(asciiCaseFold(id)) ?? 0) > 1) {
      collisions.add(index);
    }
  });
  return collisions;
}
