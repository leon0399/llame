import type { SystemModelCatalogEntry } from '../models/model-catalog';
import {
  chooseEffort,
  chooseSelector,
  nextSelectionForWrite,
  resolveHold,
  type ChatModelSelection,
  type HoldResolution,
  type EffortPolicy,
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

type ResolveFakeSelectionInput = {
  catalog: SelectionCatalog;
  stored: ChatModelSelection | null;
  request: SelectionRequest;
  writer: SelectionWriter;
  now: Date;
  resolveEffortSelection: ModelSelectionValidator['resolveEffortSelection'];
};

function resolveFakeSelection(
  input: ResolveFakeSelectionInput,
): ResolvedSelection {
  const { catalog, stored, request, writer } = input;

  const chosen = requireOfferedSelector(
    chooseSelector(catalog, stored, request),
  );

  const hold = fakeHold(input, chosen.storedUsed);

  const effort = fakeEffort({
    model: chosen.model,
    storedUsed: chosen.storedUsed,
    input,
    effortPolicy: request.effortPolicy ?? 'named',
    hold,
  });

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

function fakeHold(
  input: ResolveFakeSelectionInput,
  storedUsed: boolean,
): HoldResolution {
  return resolveHold({
    catalog: input.catalog,
    stored: input.stored,
    request: input.request,
    writer: input.writer,
    storedUsed,
    now: input.now,
  });
}

/**
 * A recorded notice effort is named unless an applied hold supersedes it.
 * Named choices use the injected resolver so test doubles can declare none.
 */
function fakeEffort(args: {
  model: SystemModelCatalogEntry;
  storedUsed: boolean;
  input: {
    stored: ChatModelSelection | null;
    request: SelectionRequest;
    resolveEffortSelection: ModelSelectionValidator['resolveEffortSelection'];
  };
  effortPolicy: EffortPolicy;
  hold: HoldResolution;
}): string | undefined {
  const held =
    args.effortPolicy === 'preferred' && args.hold.kind === 'applied';

  if (args.input.request.effort !== undefined && !held) {
    return args.input.resolveEffortSelection(
      args.model,
      args.input.request.effort,
    );
  }

  const choice = chooseEffort({
    model: args.model,
    requested: held ? undefined : args.input.request.effort,
    requestedIsPreference: false,
    storedEffort:
      args.effortPolicy === 'preferred' || !args.storedUsed
        ? null
        : (args.input.stored?.effort ?? null),
    candidateEffort: undefined,
    holdEffort:
      args.hold.kind === 'applied' ? args.hold.hold.effort : undefined,
  });

  return choice.kind === 'effort' ? choice.effort : undefined;
}
