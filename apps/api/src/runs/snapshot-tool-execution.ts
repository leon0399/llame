import { isHostCapabilityTool } from '../tools/bash';
import { type ModelToolDeclaration } from '../db/schema';
import { isRecord, isString } from '@workspace/runtime-safety';
import { TOOL_REGISTRY } from '../tools/registry';
import { resolveJsonSchema, toFlexibleSchema } from '../tools/schema-utils';
import {
  hashToolDeclaration,
  type TurnToolSource,
} from '../tools/turn-tool-catalog';
import { type Tool } from '../tools/types';
import { canonicalJson } from '../canonical-json';
import { ModelContextExecutionError } from './model-context-errors';

export type BoundExecutableTool = {
  declaration: ModelToolDeclaration;
  executor: Tool;
  /** Workspace MCP server id; absent for operator MCP and code-owned tools. */
  server?: string;
};

export type DynamicToolResolution =
  | { readonly state: 'not_dynamic' }
  | { readonly state: 'unavailable' }
  | {
      readonly state: 'available';
      readonly declarationHash: string;
      readonly executor: Tool;
      /** Set only when this executor belongs to a Workspace MCP client set. */
      readonly workspaceServer?: string;
    };

/**
 * Process-local dynamic executor lookup. One resolution is one atomic runtime
 * observation: `unavailable` means the id is configured as dynamic but the
 * current process has no matching live executor. `not_dynamic` preserves the
 * fail-fast code-owned/unknown-id integrity path.
 */
export interface DynamicToolExecutorResolver {
  resolveDynamicTool(id: string): DynamicToolResolution;
}

export function constrainDynamicToolResolver(
  resolver: DynamicToolExecutorResolver | undefined,
  sourceById: ReadonlyMap<string, TurnToolSource>,
): DynamicToolExecutorResolver | undefined {
  if (resolver === undefined) return undefined;
  return {
    resolveDynamicTool: (id) => {
      const resolution = resolver.resolveDynamicTool(id);
      const source = sourceById.get(id);
      if (source?.type !== 'mcp' || resolution.state !== 'available') {
        return resolution;
      }
      if (
        source.workspace === true &&
        resolution.workspaceServer !== source.serverId
      ) {
        return { state: 'unavailable' };
      }
      if (
        source.workspace !== true &&
        resolution.workspaceServer !== undefined
      ) {
        return { state: 'unavailable' };
      }
      return resolution;
    },
  };
}

export const DYNAMIC_TOOL_EXECUTOR_RESOLVER = Symbol(
  'DYNAMIC_TOOL_EXECUTOR_RESOLVER',
);

function invalidDeclaration(message: string): never {
  throw new ModelContextExecutionError(
    `Bound model context has an invalid tool declaration: ${message}.`,
  );
}

export function unavailableExecutor(declaration: ModelToolDeclaration): Tool {
  return {
    id: declaration.id,
    description: declaration.description,
    classification: 'unverified',
    inputSchema: declaration.inputSchema,
    execute: () => ({
      status: 'error',
      type: 'not_available',
      message: `Tool "${declaration.id}" is not available.`,
    }),
  };
}

/** Throws on a malformed or duplicate declaration; records a valid id as seen. */
function validateDeclaration(
  declaration: ModelToolDeclaration,
  seen: Set<string>,
): void {
  if (
    !declaration ||
    !isString(declaration.id) ||
    declaration.id.length === 0 ||
    !isString(declaration.description) ||
    !isRecord(declaration.inputSchema)
  ) {
    invalidDeclaration('expected a non-empty id, description, and JSON schema');
  }
  if (seen.has(declaration.id)) {
    invalidDeclaration(`duplicate tool id "${declaration.id}"`);
  }
  seen.add(declaration.id);
}

/** Binds a registry-resolved (code-owned) executor, verified against the snapshot. */
async function resolveCodeOwnedTool(
  declaration: ModelToolDeclaration,
  executor: Tool,
): Promise<BoundExecutableTool> {
  if (
    executor.classification !== 'read_only' &&
    !isHostCapabilityTool(executor)
  ) {
    throw new ModelContextExecutionError(
      `Bound model context tool "${declaration.id}" is no longer read-only.`,
    );
  }

  if (!toFlexibleSchema(executor.inputSchema)) {
    throw new ModelContextExecutionError(
      `Bound model context tool "${declaration.id}" declares an unsupported schema dialect.`,
    );
  }

  // Descriptions are rendered per attempt and are not part of the trusted
  // native executor contract. Identity and schema remain code-owned authority;
  // MCP declarations use the separate opaque declaration path below.
  const liveDeclaration = {
    id: executor.id,
    inputSchema: await resolveJsonSchema(executor.inputSchema),
  };
  const snapshottedDeclaration = {
    id: declaration.id,
    inputSchema: declaration.inputSchema,
  };
  if (
    canonicalJson(liveDeclaration) !== canonicalJson(snapshottedDeclaration)
  ) {
    throw new ModelContextExecutionError(
      `Bound model context tool "${declaration.id}" no longer matches its snapshotted declaration.`,
    );
  }

  return { declaration, executor };
}

/**
 * Binds a dynamic-resolver-supplied executor, or `undefined` when the id
 * isn't dynamic at all (the caller then treats it as unresolvable). A
 * registry entry always wins and follows the strict code-owned path below,
 * even when its id resembles a dynamic namespace. Only the runtime resolver
 * can confirm that a registry-missing id belongs to a currently configured
 * dynamic source.
 */
function resolveDynamicToolBinding(
  declaration: ModelToolDeclaration,
  dynamicResolver: DynamicToolExecutorResolver | undefined,
): BoundExecutableTool | undefined {
  const dynamicResolution = dynamicResolver?.resolveDynamicTool(declaration.id);
  if (
    dynamicResolution === undefined ||
    dynamicResolution.state === 'not_dynamic'
  ) {
    return undefined;
  }
  if (
    dynamicResolution.state === 'available' &&
    dynamicResolution.declarationHash === hashToolDeclaration(declaration) &&
    dynamicResolution.executor.id === declaration.id &&
    dynamicResolution.executor.classification === 'unverified'
  ) {
    return {
      declaration,
      executor: dynamicResolution.executor,
      ...(dynamicResolution.workspaceServer !== undefined && {
        server: dynamicResolution.workspaceServer,
      }),
    };
  }
  return { declaration, executor: unavailableExecutor(declaration) };
}

/**
 * Resolve trusted executor functions for an immutable provider-facing tool
 * manifest. The snapshot decides what is advertised; the live registry only
 * supplies code and must still match that historical declaration exactly.
 */
export async function resolveBoundExecutableTools(
  declarations: ReadonlyArray<ModelToolDeclaration>,
  registry: ReadonlyMap<string, Tool> = TOOL_REGISTRY,
  dynamicResolver?: DynamicToolExecutorResolver,
): Promise<Array<BoundExecutableTool>> {
  const seen = new Set<string>();
  const resolved: Array<BoundExecutableTool> = [];

  for (const declaration of declarations) {
    validateDeclaration(declaration, seen);

    const executor = registry.get(declaration.id);
    if (executor) {
      resolved.push(await resolveCodeOwnedTool(declaration, executor));
      continue;
    }

    const dynamicBinding = resolveDynamicToolBinding(
      declaration,
      dynamicResolver,
    );
    if (dynamicBinding !== undefined) {
      resolved.push(dynamicBinding);
      continue;
    }

    throw new ModelContextExecutionError(
      `Bound model context tool "${declaration.id}" has no registered executor.`,
    );
  }

  return resolved;
}
