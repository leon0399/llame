import { type ToolSet } from 'ai';

import { canonicalJson } from '../canonical-json';
import { type ModelToolDeclaration } from '../db/schema';
import {
  composeTurnToolCatalog,
  type AdmittedTurnTool,
  type ToolAvailabilityEntry,
  type TurnToolCandidate,
} from './turn-tool-catalog';
import { asciiCaseFoldToolId, isToolId, matchesAllowedToolId } from './tool-id';
import { unavailableExecutor } from '../runs/snapshot-tool-execution';
import { type Tool } from './types';

export type AttemptToolBinding = {
  readonly declaration: ModelToolDeclaration;
  readonly executor: Tool;
  readonly server?: string;
};

export type AttemptToolRefusal = {
  id: string;
  reason: string;
};

export type AttemptToolAdditionResult = {
  added: Array<string>;
  availableFromNextRun: Array<string>;
  refused: ReadonlyArray<AttemptToolRefusal>;
};

type AttemptToolAdditionsOptions = {
  allowedToolRules: ReadonlyArray<string>;
  callTimeoutSeconds: number;
  boundExecutables: Map<string, AttemptToolBinding>;
  createTool: (declaration: ModelToolDeclaration) => ToolSet[string];
};

type PlannedAddition = {
  readonly id: string;
  readonly tool: Tool;
  readonly declaration: ModelToolDeclaration;
};

type PlanDecision =
  | { readonly kind: 'planned'; readonly addition: PlannedAddition }
  | { readonly kind: 'available_next_run'; readonly id: string }
  | { readonly kind: 'refused'; readonly refusal: AttemptToolRefusal };

type AdditionPlan = {
  planned: Array<PlannedAddition>;
  availableFromNextRun: Array<string>;
  refused: Array<AttemptToolRefusal>;
};

type Admission = {
  admitted: ReadonlyMap<string, AdmittedTurnTool>;
  availability: ReadonlyMap<string, ToolAvailabilityEntry>;
};

async function admitWorkspaceTools(
  options: AttemptToolAdditionsOptions,
  server: string,
  tools: ReadonlyArray<Tool>,
): Promise<Admission> {
  const candidates: ReadonlyArray<TurnToolCandidate> = tools.map((tool) => ({
    source: { type: 'mcp', serverId: server },
    state: 'available',
    tool,
  }));
  const catalog = await composeTurnToolCatalog({
    allowedToolRules: options.allowedToolRules,
    callTimeoutSeconds: options.callTimeoutSeconds,
    candidates,
  });
  return {
    admitted: new Map(
      catalog.admitted.map((entry) => [entry.declaration.id, entry]),
    ),
    availability: new Map(
      catalog.manifest.entries.map((entry) => [entry.id, entry]),
    ),
  };
}

function isServerToolId(id: string, server: string): boolean {
  return id.startsWith(`mcp__${server}__`);
}

function retainedConflict(
  id: string,
  declaration: ModelToolDeclaration,
  boundExecutables: Map<string, AttemptToolBinding>,
): PlanDecision | undefined {
  const foldedId = asciiCaseFoldToolId(id);
  const collidingId = [...boundExecutables.keys()].find(
    (key) => key !== id && asciiCaseFoldToolId(key) === foldedId,
  );
  if (collidingId !== undefined) {
    return {
      kind: 'refused',
      refusal: {
        id,
        reason: 'case-only collision with an existing tool id',
      },
    };
  }
  const retained = boundExecutables.get(id);
  const declarationChanged =
    retained !== undefined &&
    canonicalJson(retained.declaration) !== canonicalJson(declaration);
  if (
    retained !== undefined &&
    (retained.server === undefined || declarationChanged)
  ) {
    if (declarationChanged) {
      boundExecutables.set(id, {
        ...retained,
        executor: unavailableExecutor(retained.declaration),
      });
    }
    return { kind: 'available_next_run', id };
  }
  return undefined;
}

function planTool(
  tool: Tool,
  server: string,
  admission: Admission,
  options: AttemptToolAdditionsOptions,
): PlanDecision {
  const id = tool.id;
  if (!isServerToolId(id, server)) {
    return {
      kind: 'refused',
      refusal: { id, reason: 'wrong_server_namespace' },
    };
  }
  if (!isToolId(id)) {
    return { kind: 'refused', refusal: { id, reason: 'invalid_tool_id' } };
  }
  if (!matchesAllowedToolId(id, options.allowedToolRules)) {
    return { kind: 'refused', refusal: { id, reason: 'not_allowlisted' } };
  }
  const entry = admission.availability.get(id);
  if (entry?.state === 'unavailable') {
    return { kind: 'refused', refusal: { id, reason: entry.reason } };
  }
  const admitted = admission.admitted.get(id);
  if (admitted === undefined) {
    return { kind: 'refused', refusal: { id, reason: 'declaration_refused' } };
  }
  const retained = retainedConflict(
    id,
    admitted.declaration,
    options.boundExecutables,
  );
  if (retained !== undefined) return retained;
  return {
    kind: 'planned',
    addition: { id, tool, declaration: admitted.declaration },
  };
}
function bindAddition(
  options: AttemptToolAdditionsOptions,
  record: ToolSet,
  server: string,
  addition: PlannedAddition,
): void {
  const retained = options.boundExecutables.get(addition.id);
  options.boundExecutables.set(addition.id, {
    declaration: retained?.declaration ?? addition.declaration,
    executor: addition.tool,
    server,
  });
  if (!(addition.id in record)) {
    record[addition.id] = options.createTool(addition.declaration);
  }
}

/**
 * Owns the mutable model tool record and its attempt-local executor bindings.
 * The model client binds the exact record it assigns to streamText before the
 * first model step; additions then mutate that record in place.
 */
export class AttemptToolAdditions {
  private toolRecord: ToolSet | undefined;
  private readonly addedDeclarationsById = new Map<
    string,
    ModelToolDeclaration
  >();

  constructor(private readonly options: AttemptToolAdditionsOptions) {}

  bindToolRecord(record: ToolSet): void {
    this.toolRecord = record;
  }

  executorFor(id: string): Tool | undefined {
    return this.options.boundExecutables.get(id)?.executor;
  }

  get addedDeclarations(): ReadonlyArray<ModelToolDeclaration> {
    return [...this.addedDeclarationsById.values()];
  }

  private plan(
    server: string,
    tools: ReadonlyArray<Tool>,
    admission: Admission,
  ): AdditionPlan {
    const plan: AdditionPlan = {
      planned: [],
      availableFromNextRun: [],
      refused: [],
    };
    for (const tool of tools) {
      const decision = planTool(tool, server, admission, this.options);
      switch (decision.kind) {
        case 'available_next_run':
          plan.availableFromNextRun.push(decision.id);
          break;
        case 'refused':
          plan.refused.push(decision.refusal);
          break;
        case 'planned':
          plan.planned.push(decision.addition);
          break;
      }
    }
    return plan;
  }

  private commit(
    server: string,
    plan: AdditionPlan,
    record: ToolSet,
  ): AttemptToolAdditionResult {
    const added = plan.planned.map((addition) => {
      this.addedDeclarationsById.set(addition.id, addition.declaration);
      bindAddition(this.options, record, server, addition);
      return addition.id;
    });
    return {
      added,
      availableFromNextRun: plan.availableFromNextRun,
      refused: plan.refused,
    };
  }

  async add(
    server: string,
    tools: ReadonlyArray<Tool>,
  ): Promise<AttemptToolAdditionResult> {
    const serverTools = tools.filter(({ id }) => isServerToolId(id, server));
    const admission = await admitWorkspaceTools(
      this.options,
      server,
      serverTools,
    );
    const plan = this.plan(server, tools, admission);
    if (plan.planned.length === 0) {
      return {
        added: [],
        availableFromNextRun: plan.availableFromNextRun,
        refused: plan.refused,
      };
    }
    const record = this.toolRecord;
    if (record === undefined) {
      return {
        added: [],
        availableFromNextRun: plan.availableFromNextRun,
        refused: [
          ...plan.refused,
          ...plan.planned.map(({ id }) => ({
            id,
            reason: 'attempt_not_ready',
          })),
        ],
      };
    }
    return this.commit(server, plan, record);
  }

  disableAll(): void {
    for (const [id, binding] of this.options.boundExecutables) {
      if (binding.server === undefined) continue;
      this.options.boundExecutables.set(id, {
        ...binding,
        executor: unavailableExecutor(binding.declaration),
      });
    }
  }
}
