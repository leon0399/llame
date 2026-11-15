"use client";

import * as React from "react";
import { Suspense } from "react";

import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import {
  hasModelId,
  modelDisplayName,
  type AvailableModel,
  type ModelsResponse,
  useModelsQuery,
} from "@/lib/services/models/queries";
import { useChatContext } from "@/contexts/chat-context";
import { ModelPreviewCard } from "@/components/ai/model-preview-card";
import { ComposerTooltip } from "./composer-tooltip";

// The searchable list (cmdk) loads when the picker first opens, keeping it
// out of every composer page's first-load bundle.
const ModelCommand = React.lazy(() =>
  import("./model-selector-list").then((module) => ({
    default: module.ModelCommand,
  })),
);

const EMPTY_MODELS: Array<AvailableModel> = [];
type ModelSelectorTriggerProps = {
  isPending: boolean;
  isError: boolean;
  open: boolean;
  selectedLabel: string;
  className?: string;
};

function ModelSelectorTrigger({
  isPending,
  isError,
  open,
  selectedLabel,
  className,
}: ModelSelectorTriggerProps) {
  return (
    <ComposerTooltip
      label="Model"
      render={
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              // `xs` (h-6, text-xs), like the permission and effort triggers in
              // the row under the input card.
              size="xs"
              // Deliberate: this trigger opens a Command/cmdk popup whose own
              // searchable input (not this button) is the real combobox host,
              // so `aria-controls` can't be wired to it meaningfully — and
              // model-selector.test.tsx / e2e already query this button by
              // role=combobox, so changing the role is a separate follow-up.
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/role-has-required-aria-props
              role="combobox"
              // role=combobox is NOT a name-from-content role, so the visible
              // label (and the loading skeleton) leave the trigger nameless to
              // screen readers without this — caught by the story a11y run.
              aria-label={
                isPending ? "Select model" : `Select model, ${selectedLabel}`
              }
              aria-expanded={open}
              // Openable while loading so the skeleton list is reachable; only a
              // hard failure (no reachable catalog) locks the trigger.
              disabled={isError}
              className={className}
            />
          }
        />
      }
    >
      {isPending ? (
        // A skeleton exactly one line-height tall (resolved against this
        // button's text-xs/1rem leading), so swapping it for the real name
        // causes no vertical layout shift.
        <Skeleton className="h-4 w-24" aria-label="Loading models" />
      ) : (
        // Regular weight: a quiet setting under the input, not an action.
        <span className="font-normal">{selectedLabel}</span>
      )}
    </ComposerTooltip>
  );
}

/** Seeds context with the catalog default the first time the current
 *  selection isn't (or is no longer) a valid model id. */
function useDefaultModelSeed(
  data: ModelsResponse | undefined,
  models: Array<AvailableModel>,
  value: string | undefined,
  setValue: (modelId: string) => void,
): void {
  React.useEffect(() => {
    if (!data || models.length === 0) return;
    if (!hasModelId(models, value)) {
      setValue(data.defaultModelId);
    }
  }, [data, models, setValue, value]);
}

/** The model shown in the preview card — the selection by default, or
 *  whatever option is under the pointer while browsing the list. The hover
 *  override is stored together with the selection it was made against, so
 *  choosing a model reverts the preview to the new selection by derivation:
 *  a `useEffect` that mirrored `value` back into this state only re-rendered
 *  one commit late (and could flash the old model). */
function usePreviewModel(
  models: Array<AvailableModel>,
  value: string | undefined,
) {
  const [hover, setHover] = React.useState<{
    modelId: string;
    selection: string | undefined;
  } | null>(null);

  const setHoveredModelId = React.useCallback(
    (modelId: string) => setHover({ modelId, selection: value }),
    [value],
  );

  const previewModelId =
    hover !== null && hover.selection === value ? hover.modelId : value;

  const previewModel = React.useMemo(
    () => models.find((model) => model.id === previewModelId),
    [models, previewModelId],
  );

  return { previewModel, setHoveredModelId };
}

// Rendered only once loaded (isPending shows a skeleton instead).
function resolveSelectedLabel(
  isError: boolean,
  effectiveValue: string | undefined,
  models: Array<AvailableModel>,
): string {
  if (isError) return "Models unavailable";
  if (!effectiveValue) return "Select a model";
  return modelDisplayName(effectiveValue, models);
}

type ModelPickerPanelProps = {
  isPending: boolean;
  isError: boolean;
  models: Array<AvailableModel>;
  effectiveValue: string | undefined;
  previewModel: AvailableModel | undefined;
  onSelect: (modelId: string) => void;
  onHover: (modelId: string) => void;
};

function ModelPickerPanel({
  isPending,
  isError,
  models,
  effectiveValue,
  previewModel,
  onSelect,
  onHover,
}: ModelPickerPanelProps) {
  return (
    <PopoverContent
      // Base UI renders the popover with role=dialog, which needs its own
      // accessible name (axe aria-dialog-name) — the trigger's label does
      // not carry over to it.
      aria-label="Model picker"
      // w-144 is 36rem: the two 18rem panes side by side.
      className={previewModel ? "w-144" : "w-72"}
      align="end"
      side="top"
    >
      {/* The popover's own p-2.5 frame is cancelled by the negative margin so
          the two panes stay flush with the popover edge, exactly as they were
          when the padding was zeroed — the picker is a split view, not an
          inset card, and the divider has to run edge to edge. */}
      <div className="relative -m-2.5 flex flex-row divide-x divide-border">
        <Suspense fallback={<div className="h-9 w-72" />}>
          <ModelCommand
            isPending={isPending}
            isError={isError}
            models={models}
            effectiveValue={effectiveValue}
            onSelect={onSelect}
            onHover={onHover}
          />
        </Suspense>

        {previewModel && (
          <ModelPreviewCard model={previewModel} className="w-72" />
        )}
      </div>
    </PopoverContent>
  );
}

/**
 * Model picker in the row under the composer's input card, beside the effort
 * selector. The trigger is a small ghost button showing the model's name;
 * the picker shows skeleton rows during the catalog's first load.
 */
export function ModelSelector({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);
  const { selectedModel: value, setSelectedModel: setValue } = useChatContext();

  const { data, isError, isPending } = useModelsQuery();
  const models = data?.models ?? EMPTY_MODELS;

  useDefaultModelSeed(data, models, value, setValue);
  const { previewModel, setHoveredModelId } = usePreviewModel(models, value);

  // Fall back to the catalog default during render so the label/checkmark
  // never flash "Select a model" in the frame before the seeding effect above
  // commits the default into context.
  const effectiveValue = value ?? data?.defaultModelId;
  const selectedLabel = resolveSelectedLabel(isError, effectiveValue, models);

  const handleSelect = (modelId: string) => {
    setValue(modelId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger
        isPending={isPending}
        isError={isError}
        open={open}
        selectedLabel={selectedLabel}
        className={className}
      />

      <ModelPickerPanel
        isPending={isPending}
        isError={isError}
        models={models}
        effectiveValue={effectiveValue}
        previewModel={previewModel}
        onSelect={handleSelect}
        onHover={setHoveredModelId}
      />
    </Popover>
  );
}
