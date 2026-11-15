"use client";

import { BotIcon, Check } from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar";
import type { AvailableModel } from "@/lib/services/models/queries";

// Loading-placeholder rows: the title width cycles so the list doesn't read as
// a uniform grid, and every other row gets a second (description) line.
const SKELETON_LINE_WIDTH_CYCLE = 4;
const MODEL_SKELETON_ROW_COUNT = 6;

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

/** The picker's searchable list (cmdk), loaded the first time the picker
 *  opens; see `ModelPickerPanel`. */
export function ModelCommand(props: ModelCommandResultsProps) {
  return (
    <Command className="w-72">
      <CommandInput placeholder="Search model..." className="h-9" />
      <CommandList>
        <ModelCommandResults {...props} />
      </CommandList>
    </Command>
  );
}
