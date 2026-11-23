import {
  type ChatModelSelection,
  type SelectionRequest,
  type SelectionWriter,
} from '../models/model-selection';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import { parseModelSelector } from '../models/model-selector';
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
  /** Role name → the model id of its first candidate. */
  roles?: ReadonlyMap<string, string>;
};

/** One selector resolved over that catalogue. */
type FakeResolvedModel = {
  readonly model: SystemModelCatalogEntry;
  readonly roleEffort: string | undefined;
};

/** One resolution's inputs, plus the resolver the double built for them. */
type FakeSelectionCall = {
  readonly stored: ChatModelSelection | null;
  readonly request: SelectionRequest;
  readonly writer: SelectionWriter;
  readonly resolveModel: (selector: string) => FakeResolvedModel;
  readonly defaultSelector: string | undefined;
};

/**
 * The `resolveSelection` half of a `ModelSelectionValidator` double: the same
 * order the production resolver follows (request selector, then the stored
 * one, then the double's default), over the double's own catalogue.
 *
 * A fake catalogue publishes no model roles unless `roles` names them, so a
 * `@name` selector resolves through `roles` and is a 422 otherwise.
 */
export function fakeResolveSelection(
  input: FakeSelectionInput,
): ModelSelectionValidator['resolveSelection'] {
  const resolveModel = fakeModelResolver(input);

  return (stored, request, writer) =>
    resolveFakeSelection(input, {
      stored,
      request,
      writer,
      resolveModel,
      defaultSelector: input.defaultSelector,
    });
}

function fakeModelResolver(
  input: Pick<FakeSelectionInput, 'validateModelSelection' | 'roles'>,
): (selector: string) => FakeResolvedModel {
  return (selector) => {
    const parsed = parseModelSelector(selector);

    if (parsed.kind === 'model') {
      return {
        model: input.validateModelSelection(parsed.modelId),
        roleEffort: undefined,
      };
    }

    const primary = input.roles?.get(parsed.roleName);

    if (primary === undefined) throw new ModelNotAvailableError(selector);

    return {
      model: input.validateModelSelection(primary),
      roleEffort: undefined,
    };
  };
}

function resolveFakeSelection(
  input: FakeSelectionInput,
  call: FakeSelectionCall,
): ResolvedSelection {
  const { stored, request, writer, resolveModel } = call;
  const { selector, usedStored } = fakeSelectorFor(call);
  const { model, roleEffort } = resolveModel(selector);

  const effort = resolveSelectionEffort({
    model,
    request,
    stored,
    usedStoredSelector: usedStored,
    roleEffort,
    resolveEffortSelection: input.resolveEffortSelection,
  });

  const wrote =
    request.selector !== undefined ||
    request.effort !== undefined ||
    stored === null ||
    !usedStored;

  const nextSelection =
    writer === 'derived'
      ? undefined
      : nextSelectionFor({ stored, request, selector, effort, wrote });

  return { selector, model, effort, nextSelection };
}

/** The selector one fake call settles on, and whose selector it was. */
type FakeSelectorChoice = {
  selector: string;
  usedStored: boolean;
};

/** The selector the call settles on, and whether the Chat's stored one was it. */
function fakeSelectorFor(call: FakeSelectionCall): FakeSelectorChoice {
  const { stored, request, resolveModel } = call;
  const requested = request.selector;

  const storedSelector =
    stored !== null && isResolvable(stored.selector, resolveModel)
      ? stored.selector
      : undefined;

  const usedStored = requested === undefined && storedSelector !== undefined;
  const selector = requested ?? storedSelector ?? call.defaultSelector;

  if (selector === undefined) {
    throw new ModelConfigurationError('defaults.selector is required.');
  }

  return { selector, usedStored };
}

function isResolvable(
  selector: string,
  resolveModel: (selector: string) => FakeResolvedModel,
): boolean {
  try {
    resolveModel(selector);

    return true;
  } catch {
    return false;
  }
}

function resolveSelectionEffort(input: {
  model: SystemModelCatalogEntry;
  request: SelectionRequest;
  stored: ChatModelSelection | null;
  usedStoredSelector: boolean;
  roleEffort: string | undefined;
  resolveEffortSelection: ModelSelectionValidator['resolveEffortSelection'];
}): string | undefined {
  const { model, request, stored, usedStoredSelector, roleEffort } = input;

  if (request.effort !== undefined) {
    return input.resolveEffortSelection(model, request.effort);
  }

  if (
    request.selector === undefined &&
    usedStoredSelector &&
    stored?.effort != null &&
    model.reasoning?.effortLevels.some((level) => level.value === stored.effort)
  ) {
    return stored.effort;
  }

  if (roleEffort !== undefined) return roleEffort;

  return model.reasoning?.defaultEffort;
}

function nextSelectionFor(input: {
  stored: ChatModelSelection | null;
  request: SelectionRequest;
  selector: string;
  effort: string | undefined;
  wrote: boolean;
}): ChatModelSelection | undefined {
  if (!input.wrote) return undefined;

  const nextSelection: ChatModelSelection = {
    revision: (input.stored?.revision ?? 0) + 1,
    selector: input.selector,
    effort: input.effort ?? null,
  };

  const hold = input.stored?.hold;

  if (
    hold === undefined ||
    input.request.effort === undefined ||
    input.request.selector !== undefined
  ) {
    return nextSelection;
  }

  return { ...nextSelection, hold };
}
