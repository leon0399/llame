/**
 * `McpRuntimeService`'s server-definition shape and its one piece of pure
 * logic: freezing a definition (including its nested `args`/`env`/`headers`)
 * so a `ServerRecord` can never be mutated through the config object a
 * caller still holds a reference to.
 */

export type McpRuntimeRemoteDefinition = Readonly<{
  transport?: 'http';
  url: string;
  headers?: Readonly<Record<string, string>>;
  fetch?: typeof globalThis.fetch;
}>;

export type McpRuntimeStdioDefinition = Readonly<{
  transport: 'stdio';
  command: string;
  args?: ReadonlyArray<string>;
  env?: Readonly<Record<string, string>>;
  cwd?: string;
  protectedValues?: ReadonlyArray<string>;
}>;

export type McpRuntimeServerDefinition =
  | McpRuntimeRemoteDefinition
  | McpRuntimeStdioDefinition;

export const isStdio = (
  definition: McpRuntimeServerDefinition,
): definition is McpRuntimeStdioDefinition => definition.transport === 'stdio';

// Exported so mcp-runtime.module.ts's config->runtime translation can share
// this shape rather than redeclaring it.
export type MutableStdioDefinition = {
  transport: 'stdio';
  command: string;
  args?: ReadonlyArray<string>;
  env?: Readonly<Record<string, string>>;
  cwd?: string;
  protectedValues?: ReadonlyArray<string>;
};

type MutableRemoteDefinition = {
  url: string;
  headers?: Readonly<Record<string, string>>;
  fetch?: typeof globalThis.fetch;
};

export function frozenRuntimeDefinition(
  definition: McpRuntimeServerDefinition,
): McpRuntimeServerDefinition {
  if (isStdio(definition)) {
    const stdio: MutableStdioDefinition = {
      transport: 'stdio',
      command: definition.command,
    };
    if (definition.args !== undefined) {
      stdio.args = Object.freeze([...definition.args]);
    }
    if (definition.env !== undefined) {
      stdio.env = Object.freeze({ ...definition.env });
    }
    if (definition.cwd !== undefined) stdio.cwd = definition.cwd;
    if (definition.protectedValues !== undefined) {
      stdio.protectedValues = Object.freeze([...definition.protectedValues]);
    }
    return Object.freeze(stdio);
  }

  const remote: MutableRemoteDefinition = {
    url: definition.url,
  };
  if (definition.headers !== undefined) {
    remote.headers = Object.freeze({ ...definition.headers });
  }
  if (definition.fetch !== undefined) remote.fetch = definition.fetch;
  return Object.freeze(remote);
}
