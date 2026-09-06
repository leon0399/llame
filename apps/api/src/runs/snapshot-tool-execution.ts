import { type ModelToolDeclaration } from '../db/schema';
import { isRecord, isString } from '@workspace/runtime-safety';
import { TOOL_REGISTRY } from '../tools/registry';
import { resolveJsonSchema, toFlexibleSchema } from '../tools/schema-utils';
import { hashToolDeclaration } from '../tools/turn-tool-catalog';
import { type Tool } from '../tools/types';
import { canonicalJson } from '../canonical-json';

export class ModelContextExecutionError extends Error {
  readonly code: string = 'model_context_incompatible';

  constructor(message: string) {
    super(message);
    this.name = 'ModelContextExecutionError';
  }
}

export class ContextIncompatibleError extends ModelContextExecutionError {
  override readonly code = 'context_incompatible';

  constructor(message: string, options?: ErrorOptions) {
    super(message);
    this.name = 'ContextIncompatibleError';
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export type BoundExecutableTool = {
  declaration: ModelToolDeclaration;
  executor: Tool;
};

export type DynamicToolResolution =
  | { readonly state: 'not_dynamic' }
  | { readonly state: 'unavailable' }
  | {
      readonly state: 'available';
      readonly declarationHash: string;
      readonly executor: Tool;
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

export const DYNAMIC_TOOL_EXECUTOR_RESOLVER = Symbol(
  'DYNAMIC_TOOL_EXECUTOR_RESOLVER',
);

function invalidDeclaration(message: string): never {
  throw new ModelContextExecutionError(
    `Bound model context has an invalid tool declaration: ${message}.`,
  );
}

function unavailableExecutor(declaration: ModelToolDeclaration): Tool {
  return {
    id: declaration.id,
    description: declaration.description,
    classification: 'read_only',
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
  if (executor.classification !== 'read_only') {
    throw new ModelContextExecutionError(
      `Bound model context tool "${declaration.id}" is no longer read-only.`,
    );
  }

  if (!toFlexibleSchema(executor.inputSchema)) {
    throw new ModelContextExecutionError(
      `Bound model context tool "${declaration.id}" declares an unsupported schema dialect.`,
    );
  }

  const liveDeclaration = {
    id: executor.id,
    description: executor.description,
    inputSchema: await resolveJsonSchema(executor.inputSchema),
  };
  if (canonicalJson(liveDeclaration) !== canonicalJson(declaration)) {
    throw new ModelContextExecutionError(
      `Bound model context tool "${declaration.id}" no longer matches its snapshotted declaration.`,
    );
  }

  return { declaration, executor };
}

/**
 * Binds a dynamic-resolver-supplied executor, or `undefined` when the id
 * isn't dynamic at all (the caller then treats it as unresolvable). A
 * registry entry always wins and follows the strict code-owned path above,
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
    dynamicResolution.executor.classification === 'read_only'
  ) {
    return { declaration, executor: dynamicResolution.executor };
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
