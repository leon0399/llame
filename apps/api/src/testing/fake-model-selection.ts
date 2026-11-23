import type { SystemModelCatalogEntry } from '../models/model-catalog';
import {
  chooseEffort,
  chooseSelector,
  nextSelectionForWrite,
  resolveHold,
  type ChatModelSelection,
  type SelectionCatalog,
  type SelectionRequest,
  type SelectionWriter,
} from '../models/model-selection';
import {
  requireOfferedSelector,
  type ModelSelectionValidator,
  type ResolvedSelection,
} from '../models/models.service';

/** The double's catalogue: what it validates against and resolves over. */
type FakeSelectionInput = {
  validateModelSelection: ModelSelectionValidator['validateModelSelection'];
  resolveEffortSelection: ModelSelectionValidator['resolveEffortSelection'];
  /** The selector used when neither the request nor the Chat names one. */
  defaultSelector?: string;
};

/**
 * The `resolveSelection` half of a `ModelSelectionValidator` double: the same
 * order the production resolver follows (request selector, then the stored
 * one, then the double's default), over the double's own catalogue and
 * through the production selection helpers, so no rule is restated here.
 *
 * The double publishes no model roles, so a `@name` selector is a 422. The
 * only rule it keeps its own is effort validation: many doubles delegate the
 * requested level to the injected `resolveEffortSelection`, which the
 * production order applies after it has narrowed the stored effort.
 */
export function fakeResolveSelection(
  input: FakeSelectionInput,
): ModelSelectionValidator['resolveSelection'] {
  const catalog = fakeSelectionCatalog(input);

  return (stored, request, writer, now) =>
    resolveFakeSelection({
      catalog,
      stored,
      request,
      writer,
      now,
      resolveEffortSelection: input.resolveEffortSelection,
    });
}

/** The double's catalogue: no roles, and only the model ids it validates. */
function fakeSelectionCatalog(input: FakeSelectionInput): SelectionCatalog {
  return {
    defaultSelector: input.defaultSelector,
    roleCandidates: () => undefined,
    model: (modelId) => offeredModel(input, modelId),
  };
}

function offeredModel(
  input: FakeSelectionInput,
  modelId: string,
): SystemModelCatalogEntry | undefined {
  try {
    return input.validateModelSelection(modelId);
  } catch {
    return undefined;
  }
}

function resolveFakeSelection(input: {
  catalog: SelectionCatalog;
  stored: ChatModelSelection | null;
  request: SelectionRequest;
  writer: SelectionWriter;
  now: Date;
  resolveEffortSelection: ModelSelectionValidator['resolveEffortSelection'];
}): ResolvedSelection {
  const { catalog, stored, request, writer } = input;

  const chosen = requireOfferedSelector(
    chooseSelector(catalog, stored, request),
  );

  // The double publishes no roles, so a hold always names a model it cannot
  // fall back from and is dropped; taking the decision from the production
  // `resolveHold` keeps even that case in one place.
  const hold = resolveHold({
    catalog,
    stored,
    request,
    storedUsed: chosen.storedUsed,
    now: input.now,
  });

  const effort = fakeEffort(chosen.model, chosen.storedUsed, input);

  return {
    selector: chosen.selector,
    model: chosen.model,
    effort,
    nextSelection: nextSelectionForWrite({
      stored,
      request,
      writer,
      selector: chosen.selector,
      effort,
      storedUsed: chosen.storedUsed,
      hold,
    }),
  };
}

/**
 * The resolved effort: a named level goes through the injected resolver (the
 * doubles stay free to declare none), while the omitted order — the stored
 * effort, then the model's default — is the production `chooseEffort`.
 */
function fakeEffort(
  model: SystemModelCatalogEntry,
  storedUsed: boolean,
  input: {
    stored: ChatModelSelection | null;
    request: SelectionRequest;
    resolveEffortSelection: ModelSelectionValidator['resolveEffortSelection'];
  },
): string | undefined {
  if (input.request.effort !== undefined) {
    return input.resolveEffortSelection(model, input.request.effort);
  }

  const choice = chooseEffort({
    model,
    requested: undefined,
    storedEffort: storedUsed ? (input.stored?.effort ?? null) : null,
    candidateEffort: undefined,
  });

  return choice.kind === 'effort' ? choice.effort : undefined;
}
