import { asSchema } from 'ai';

import { type ModelToolDeclaration } from '../db/schema';
import { TOOL_REGISTRY } from '../tools/registry';
import { type Tool } from '../tools/types';
import { canonicalJson } from './effective-context-resolver';

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

function invalidDeclaration(message: string): never {
  throw new ModelContextExecutionError(
    `Bound model context has an invalid tool declaration: ${message}.`,
  );
}

/**
 * Resolve trusted executor functions for an immutable provider-facing tool
 * manifest. The snapshot decides what is advertised; the live registry only
 * supplies code and must still match that historical declaration exactly.
 */
export async function resolveBoundExecutableTools(
  declarations: readonly ModelToolDeclaration[],
  registry: ReadonlyMap<string, Tool> = TOOL_REGISTRY,
): Promise<BoundExecutableTool[]> {
  const seen = new Set<string>();
  const resolved: BoundExecutableTool[] = [];

  for (const declaration of declarations) {
    if (
      !declaration ||
      typeof declaration.id !== 'string' ||
      declaration.id.length === 0 ||
      typeof declaration.description !== 'string' ||
      declaration.inputSchema === null ||
      Array.isArray(declaration.inputSchema) ||
      typeof declaration.inputSchema !== 'object'
    ) {
      invalidDeclaration(
        'expected a non-empty id, description, and JSON schema',
      );
    }
    if (seen.has(declaration.id)) {
      invalidDeclaration(`duplicate tool id "${declaration.id}"`);
    }
    seen.add(declaration.id);

    const executor = registry.get(declaration.id);
    if (!executor) {
      throw new ModelContextExecutionError(
        `Bound model context tool "${declaration.id}" has no registered executor.`,
      );
    }
    if (executor.classification !== 'read_only') {
      throw new ModelContextExecutionError(
        `Bound model context tool "${declaration.id}" is no longer read-only.`,
      );
    }

    const liveDeclaration = {
      id: executor.id,
      description: executor.description,
      inputSchema: await asSchema(executor.inputSchema).jsonSchema,
    };
    if (canonicalJson(liveDeclaration) !== canonicalJson(declaration)) {
      throw new ModelContextExecutionError(
        `Bound model context tool "${declaration.id}" no longer matches its snapshotted declaration.`,
      );
    }

    resolved.push({ declaration, executor });
  }

  return resolved;
}
