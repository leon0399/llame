const SERVER_ID = /^[A-Za-z0-9_-]+$/u;
const UNSAFE_TOOL_NAME_RUN = /[^A-Za-z0-9_-]+/gu;
const EDGE_UNDERSCORES = /^_+|_+$/gu;
const MAX_TOOL_ID_LENGTH = 64;

export type McpToolIdResult =
  | { success: true; id: string }
  | {
      success: false;
      reason: 'invalid_server_id' | 'empty_tool_name' | 'overlength';
    };

function asciiCaseFold(value: string): string {
  return value.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
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

  const id = `mcp__${serverId}__${toolName}`;
  if (id.length > MAX_TOOL_ID_LENGTH) {
    return { success: false, reason: 'overlength' };
  }

  return { success: true, id };
}

export function findAsciiCaseFoldedCollisionIndexes(
  ids: readonly string[],
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
