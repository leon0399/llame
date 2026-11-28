"use client";

import * as React from "react";
import { BotIcon, Check } from "lucide-react";

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
import type {
  ChatFallbackHoldResponse,
  ModelRoleResponse,
} from "@/lib/api/generated/models";
import {
  modelDisplayName,
  type AvailableModel,
  type ModelsResponse,
  useModelsQuery,
} from "@/lib/services/models/queries";
import {
  localTimeOf,
  resolveDisplayedModel,
  type ComposerSelection,
} from "@/lib/services/models/selection";
import { useChatContext } from "@/contexts/chat-context";
import { ModelPreviewCard } from "@/components/ai/model-preview-card";
import { useComposerControlSize } from "./composer-control-size";
import { ComposerTooltip } from "./composer-tooltip";
import { useComposerSelection } from "./use-composer-selection";

const EMPTY_ROLES: Array<ModelRoleResponse> = [];

// Loading-placeholder rows: the title width cycles so the list doesn't read as
// a uniform grid, and every other row gets a second (description) line.
const SKELETON_LINE_WIDTH_CYCLE = 4;
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
    <ComposerTooltip
      label="Model"
      render={
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              // `xs` (h-6, text-xs), like the permission and effort triggers in
              // the row under the input card.
              size={useComposerControlSize()}
              // Deliberate: this trigger opens a Command/cmdk popup whose own
              // searchable input (not this button) is the real combobox host,
              // so `aria-controls` can't be wired to it meaningfully — and
              // model-selector tests / e2e already query this button by
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
        <span className="min-w-0 overflow-x-clip font-normal text-ellipsis whitespace-nowrap text-trim-cap">
          {selectedLabel}
        </span>
      )}
    </ComposerTooltip>
  );
}

function ModelSkeletonRow({ index }: { index: number }) {
  const cycle = index % SKELETON_LINE_WIDTH_CYCLE;

  // A ternary over literal widths, not an index into an array of them: the
  // class has to be statically readable (shadcn/require-static-classes).
  const lineWidth =
    cycle === 0 ? "w-28" : cycle === 1 ? "w-20" : cycle === 2 ? "w-32" : "w-24";

  return (
    <div className="flex items-center gap-2 px-2 py-2">
      <Skeleton className="size-7 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className={cn("h-3", lineWidth)} />
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

/** The checkmark every option shows when it is the selection. */
function SelectionCheck({ isSelected }: { isSelected: boolean }) {
  return (
    <div
      className={cn(
        "ml-auto text-foreground dark:text-foreground",
        isSelected ? "opacity-100" : "opacity-0",
      )}
    >
      <Check />
    </div>
  );
}

type RoleOptionProps = {
  role: ModelRoleResponse;
  models: ReadonlyArray<AvailableModel>;
  isSelected: boolean;
  onSelect: (selector: string) => void;
  onHover: (selector: string) => void;
};

/** One role row: its selector, then the candidates in chain order. Picking it
 *  makes the next send name `selector` instead of a model id. */
function RoleOption({
  role,
  models,
  isSelected,
  onSelect,
  onHover,
}: RoleOptionProps) {
  const candidateNames = role.candidates
    .map((candidate) => modelDisplayName(candidate.modelId, models))
    .join(" → ");

  return (
    <CommandItem
      value={role.selector}
      aria-label={role.selector}
      onSelect={onSelect}
      onMouseEnter={() => onHover(role.selector)}
    >
      <div className="gap-2 group/item flex flex-row items-center w-full">
        <Avatar>
          <AvatarFallback>
            <BotIcon className="size-4" />
          </AvatarFallback>
        </Avatar>

        <div className="flex flex-col gap-1 items-start text-start">
          <div className="font-mono">{role.selector}</div>
          <div className="text-xs">{candidateNames}</div>
        </div>

        <SelectionCheck isSelected={isSelected} />
      </div>
    </CommandItem>
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
          <AvatarFallback>
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

        <SelectionCheck isSelected={isSelected} />
      </div>
    </CommandItem>
  );
}

/** The selection the option under the pointer would show, keeping an
 *  applicable hold only for the role it belongs to. */
function hoveredSelection(
  hovered: string,
  selection: ComposerSelection | null,
): ComposerSelection {
  if (selection !== null && hovered === selection.selector) return selection;

  return { selector: hovered, effort: null };
}

/** The model shown in the preview card — the displayed selection's model by
 *  default, or whatever option is under the pointer while browsing the list.
 *  The hover override is stored together with the selection it was made
 *  against, so choosing an option reverts the preview to the new selection by
 *  derivation: a `useEffect` that mirrored the selection back into this state
 *  only re-rendered one commit late (and could flash the old model). */
function usePreviewModel(
  data: ModelsResponse | undefined,
  selection: ComposerSelection | null,
) {
  const shownSelector = selection?.selector;

  const [hover, setHover] = React.useState<{
    selector: string;
    selection: string | undefined;
  } | null>(null);

  const setHoveredSelector = React.useCallback(
    (selector: string) => setHover({ selector, selection: shownSelector }),
    [shownSelector],
  );

  const previewed =
    hover !== null && hover.selection === shownSelector
      ? hoveredSelection(hover.selector, selection)
      : selection;

  const previewModel = React.useMemo(
    () => resolveDisplayedModel(previewed, data),
    [data, previewed],
  );

  return { previewModel, setHoveredSelector };
}

/** The trigger label: the exact model's name, the role's selector, or — with
 *  an applicable hold — the role, the held model, and when the Chat returns. */
function resolveSelectedLabel(input: {
  isError: boolean;
  selection: ComposerSelection | null;
  hold: ChatFallbackHoldResponse | undefined;
  models: ReadonlyArray<AvailableModel>;
}): string {
  const { selection, hold } = input;

  if (input.isError) return "Models unavailable";

  if (selection === null) return "Select a model";

  if (hold !== undefined) {
    return `${selection.selector} → ${modelDisplayName(
      hold.modelId,
      input.models,
    )} until ${localTimeOf(hold.revertAt)}`;
  }

  if (selection.selector.startsWith("@")) return selection.selector;

  return modelDisplayName(selection.selector, input.models);
}

type RoleOptionsProps = {
  roles: ReadonlyArray<ModelRoleResponse>;
  models: ReadonlyArray<AvailableModel>;
  effectiveValue: string | undefined;
  onSelect: (selector: string) => void;
  onHover: (selector: string) => void;
};

/** The role rows, ahead of the models: a pick sends the role selector. */
function RoleOptions({
  roles,
  models,
  effectiveValue,
  onSelect,
  onHover,
}: RoleOptionsProps) {
  if (roles.length === 0) return null;

  return (
    <CommandGroup heading="Roles">
      {roles.map((role) => (
        <RoleOption
          key={role.selector}
          role={role}
          models={models}
          isSelected={effectiveValue === role.selector}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </CommandGroup>
  );
}

type ModelOptionsProps = {
  models: ReadonlyArray<AvailableModel>;
  heading: string | undefined;
  effectiveValue: string | undefined;
  onSelect: (selector: string) => void;
  onHover: (selector: string) => void;
};

function ModelOptions({
  models,
  heading,
  effectiveValue,
  onSelect,
  onHover,
}: ModelOptionsProps) {
  return (
    <CommandGroup heading={heading}>
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
  );
}

type ModelCommandResultsProps = RoleOptionsProps &
  Pick<ModelOptionsProps, "heading"> & {
    isPending: boolean;
    isError: boolean;
  };

function ModelCommandResults({
  isPending,
  isError,
  models,
  roles,
  heading,
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
      <RoleOptions
        roles={roles}
        models={models}
        effectiveValue={effectiveValue}
        onSelect={onSelect}
        onHover={onHover}
      />
      <ModelOptions
        models={models}
        heading={heading}
        effectiveValue={effectiveValue}
        onSelect={onSelect}
        onHover={onHover}
      />
    </>
  );
}

type ModelPickerSplitProps = ModelCommandResultsProps & {
  previewModel: AvailableModel | undefined;
};

/** The picker's two panes: the searchable list, and the preview card. */
function ModelPickerSplit({ previewModel, ...results }: ModelPickerSplitProps) {
  return (
    // The popover's own p-2.5 frame is cancelled by the negative margin so the
    // two panes stay flush with the popover edge, exactly as they were when
    // the padding was zeroed — the picker is a split view, not an inset card,
    // and the divider has to run edge to edge.
    <div className="relative -m-2.5 flex flex-row divide-x divide-border">
      <Command className="w-72">
        <CommandInput placeholder="Search model..." className="h-9" />
        <CommandList>
          <ModelCommandResults {...results} />
        </CommandList>
      </Command>

      {previewModel && (
        <ModelPreviewCard model={previewModel} className="w-72" />
      )}
    </div>
  );
}

function ModelPickerPanel(props: ModelPickerSplitProps) {
  return (
    <PopoverContent
      // Base UI renders the popover with role=dialog, which needs its own
      // accessible name (axe aria-dialog-name) — the trigger's label does
      // not carry over to it.
      aria-label="Model picker"
      // w-144 is 36rem: the two 18rem panes side by side.
      className={props.previewModel ? "w-144" : "w-72"}
      align="end"
      side="top"
    >
      <ModelPickerSplit {...props} />
    </PopoverContent>
  );
}

/**
 * Model picker in the row under the composer's input card, beside the effort
 * selector. It lists the configured roles, then the models, and shows the
 * Chat's stored selection — including an applicable fallback hold, with the
 * held model and when the Chat returns to the role. A pick makes the next send
 * name `selector`; without one, the Chat's stored selection applies.
 */
export function ModelSelector({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);
  const { pickSelector } = useChatContext();

  const { data, selection, hold, availableModels } = useComposerSelection();
  const { isError, isPending } = useModelsQuery();

  const { previewModel, setHoveredSelector } = usePreviewModel(data, selection);

  const selectedLabel = resolveSelectedLabel({
    isError,
    selection,
    hold,
    models: availableModels,
  });

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
        models={availableModels}
        roles={data?.roles ?? EMPTY_ROLES}
        heading={
          data !== undefined && data.roles.length > 0 ? "Models" : undefined
        }
        effectiveValue={selection?.selector}
        previewModel={previewModel}
        onSelect={(selector) => {
          pickSelector(selector);
          setOpen(false);
        }}
        onHover={setHoveredSelector}
      />
    </Popover>
  );
}
