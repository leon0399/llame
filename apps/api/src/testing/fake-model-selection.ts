import type { SystemModelCatalogEntry } from '../models/model-catalog';
import {
  chooseEffort,
  chooseSelector,
  nextSelectionForWrite,
  type ChatModelSelection,
  type SelectionCatalog,
  type SelectionRequest,
  type SelectionWriter,
} from '../models/model-selection';
import {
  ModelConfigurationError,
  ModelNotAvailableError,
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

  return (stored, request, writer) =>
    resolveFakeSelection({
      catalog,
      stored,
      request,
      writer,
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
  resolveEffortSelection: ModelSelectionValidator['resolveEffortSelection'];
}): ResolvedSelection {
  const { catalog, stored, request, writer } = input;
  const chosen = chooseSelector(catalog, stored, request);

  if (chosen.kind === 'unknown') {
    throw new ModelNotAvailableError(chosen.selector);
  }

  if (chosen.kind === 'no-default') {
    throw new ModelConfigurationError('defaults.selector is required.');
  }

  if (chosen.kind === 'unresolved-default') {
    throw new ModelConfigurationError(
      'defaults.selector must reference a configured model or model role.',
    );
  }

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
