"use client";

import * as React from "react";
import { BotIcon, Check, ChevronDownIcon } from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar";
import {
  hasModelId,
  modelDisplayName,
  type AvailableModel,
  type ModelsResponse,
  useModelsQuery,
} from "@/lib/services/models/queries";
import { useChatContext } from "@/contexts/chat-context";
import { ModelPreviewCard } from "@/components/ai/model-preview-card";

const EMPTY_MODELS: Array<AvailableModel> = [];

// Loading-placeholder rows: the title width cycles so the list doesn't read as
// a uniform grid, and every other row gets a second (description) line.
const SKELETON_LINE_WIDTHS = ["w-28", "w-20", "w-32", "w-24"] as const;
const MODEL_SKELETON_ROW_COUNT = 6;

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
    <PopoverTrigger
      render={
        <Button
          variant="outline"
          // "default" is h-8, the same box as the send cell's size="icon"
          // (size-8). They must be stated in the same unit family or they
          // drift: `sm` is h-7, and a stale comment here once claimed it was
          // h-8, which is how the pill came to hold three different heights.
          size="default"
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
          // ButtonGroup owns corner rounding, border collapsing, and the
          // focus-ring lift — this cell states none of it.
          className={cn(
            // No px here: size="default" already sets px-2.5, and it also
            // carries conditional icon padding that a duplicate px would
            // override. Only genuine overrides of the variant belong here.
            "gap-1 text-[0.8125rem] font-medium text-foreground",
            className,
          )}
        />
      }
    >
      {isPending ? (
        // A skeleton exactly one line-height tall (resolved against this
        // button's font size) — swapping it for the real name causes no
        // vertical layout shift.
        <Skeleton
          className="h-[1lh] w-24 rounded-sm"
          aria-label="Loading models"
        />
      ) : (
        <>
          {selectedLabel}
          <ChevronDownIcon className="size-3.5 opacity-50" />
        </>
      )}
    </PopoverTrigger>
  );
}

function ModelSkeletonRow({ index }: { index: number }) {
  return (
    <div className="flex items-center gap-2 px-2 py-2">
      <Skeleton className="size-7 shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton
          className={cn(
            "h-3",
            SKELETON_LINE_WIDTHS[index % SKELETON_LINE_WIDTHS.length],
          )}
        />
        {index % 2 === 0 && <Skeleton className="h-2.5 w-40" />}
      </div>
    </div>
  );
}

function ModelListSkeleton() {
  return (
    <div className="p-1" aria-hidden>
      {Array.from({ length: MODEL_SKELETON_ROW_COUNT }, (_, index) => (
        <ModelSkeletonRow key={index} index={index} />
      ))}
    </div>
  );
}

type ModelOptionProps = {
  model: AvailableModel;
  isSelected: boolean;
  onSelect: (modelId: string) => void;
  onHover: (modelId: string) => void;
};

function ModelOption({
  model,
  isSelected,
  onSelect,
  onHover,
}: ModelOptionProps) {
  return (
    <CommandItem
      value={model.id}
      onSelect={onSelect}
      onMouseEnter={() => onHover(model.id)}
    >
      {/* Plain div, not a nested <button>: CommandItem is the
          interactive control (role=option, its own onSelect);
          a focusable button inside it is a redundant tab stop
          and nested-interactive a11y violation. */}
      <div className="gap-2 group/item flex flex-row items-center w-full">
        <Avatar>
          <AvatarFallback className="bg-muted text-muted-foreground">
            <BotIcon className="size-4" />
          </AvatarFallback>
        </Avatar>

        <div className="flex flex-col gap-1 items-start text-start">
          <div>{model.name || model.id}</div>
          {model.description && (
            <div className="text-xs text-muted-foreground">
              {model.description}
            </div>
          )}
        </div>

        <div
          className={cn(
            "ml-auto text-foreground dark:text-foreground",
            isSelected ? "opacity-100" : "opacity-0",
          )}
        >
          <Check />
        </div>
      </div>
    </CommandItem>
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
 *  whatever option is under the pointer while browsing the list. */
function usePreviewModel(
  models: Array<AvailableModel>,
  value: string | undefined,
) {
  const [previewModelId, setPreviewModelId] = React.useState<
    string | undefined
  >(value);
  React.useEffect(() => {
    setPreviewModelId(value);
  }, [value]);

  const previewModel = React.useMemo(
    () => models.find((model) => model.id === previewModelId),
    [models, previewModelId],
  );

  return { previewModel, setPreviewModelId };
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

type ModelCommandResultsProps = {
  isPending: boolean;
  isError: boolean;
  models: Array<AvailableModel>;
  effectiveValue: string | undefined;
  onSelect: (modelId: string) => void;
  onHover: (modelId: string) => void;
};

function ModelCommandResults({
  isPending,
  isError,
  models,
  effectiveValue,
  onSelect,
  onHover,
}: ModelCommandResultsProps) {
  if (isPending) return <ModelListSkeleton />;
  return (
    <>
      <CommandEmpty>
        {isError ? "Models unavailable." : "No model found."}
      </CommandEmpty>
      <CommandGroup>
        {models.map((model) => (
          <ModelOption
            key={model.id}
            model={model}
            isSelected={effectiveValue === model.id}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))}
      </CommandGroup>
    </>
  );
}

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
      className={cn("p-0", previewModel ? "w-[36rem]" : "w-72")}
      align="end"
      side="top"
    >
      <div className="relative flex flex-row divide-x divide-border">
        <Command className="rounded-e-none w-72">
          <CommandInput placeholder="Search model..." className="h-9" />
          <CommandList>
            <ModelCommandResults
              isPending={isPending}
              isError={isError}
              models={models}
              effectiveValue={effectiveValue}
              onSelect={onSelect}
              onHover={onHover}
            />
          </CommandList>
        </Command>

        {previewModel && (
          <ModelPreviewCard model={previewModel} className="w-72" />
        )}
      </div>
    </PopoverContent>
  );
}

/**
 * Model picker that lives inside the composer, grouped with the send button.
 * The trigger renders inline (borderless — the group wrapper owns the border)
 * and swaps its chevron for a spinner while the catalog is loading; the picker
 * itself shows skeleton rows during that first load.
 */
export function ModelSelector({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);
  const { selectedModel: value, setSelectedModel: setValue } = useChatContext();

  const { data, isError, isPending } = useModelsQuery();
  const models = data?.models ?? EMPTY_MODELS;

  useDefaultModelSeed(data, models, value, setValue);
  const { previewModel, setPreviewModelId } = usePreviewModel(models, value);

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
        onHover={setPreviewModelId}
      />
    </Popover>
  );
}
