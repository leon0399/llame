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
  useModelsQuery,
} from "@/lib/services/models/queries";
import { useChatContext } from "@/contexts/chat-context";
import { ModelPreviewCard } from "@/components/ai/model-preview-card";

const EMPTY_MODELS: AvailableModel[] = [];

// Loading-placeholder rows: the title width cycles so the list doesn't read as
// a uniform grid, and every other row gets a second (description) line.
const SKELETON_LINE_WIDTHS = ["w-28", "w-20", "w-32", "w-24"] as const;
const MODEL_SKELETON_ROW_COUNT = 6;

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

  React.useEffect(() => {
    if (!data || models.length === 0) return;
    if (!hasModelId(models, value)) {
      setValue(data.defaultModelId);
    }
  }, [data, models, setValue, value]);

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

  // Rendered only once loaded (isPending shows a skeleton instead).
  const selectedLabel = isError
    ? "Models unavailable"
    : !value
      ? "Select a model"
      : modelDisplayName(value, models);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          // Openable while loading so the skeleton list is reachable; only a
          // hard failure (no reachable catalog) locks the trigger.
          disabled={isError}
          // size="sm" gives h-8 (32px), matching the send button (size-8) so
          // both cells of the group pill are the same height (design: 1.9rem).
          // The consumer owns corner rounding (it knows the cell's position in
          // the group), so the focus ring isn't clipped.
          className={cn(
            "gap-1 px-2.5 text-[0.8125rem] font-medium text-foreground",
            className,
          )}
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
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className={cn("p-0", previewModel ? "w-[36rem]" : "w-72")}
        align="end"
        side="top"
      >
        <div className="relative flex flex-row divide-x divide-border">
          <Command className="rounded-e-none w-72">
            <CommandInput placeholder="Search model..." className="h-9" />
            <CommandList>
              {isPending ? (
                <div className="p-1" aria-hidden>
                  {Array.from(
                    { length: MODEL_SKELETON_ROW_COUNT },
                    (_, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 px-2 py-2"
                      >
                        <Skeleton className="size-7 shrink-0 rounded-lg" />
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <Skeleton
                            className={cn(
                              "h-3",
                              SKELETON_LINE_WIDTHS[
                                index % SKELETON_LINE_WIDTHS.length
                              ],
                            )}
                          />
                          {index % 2 === 0 && (
                            <Skeleton className="h-2.5 w-40" />
                          )}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <>
                  <CommandEmpty>
                    {isError ? "Models unavailable." : "No model found."}
                  </CommandEmpty>
                  <CommandGroup>
                    {models.map((model) => (
                      <CommandItem
                        key={model.id}
                        value={model.id}
                        onSelect={(currentValue) => {
                          setValue(currentValue);
                          setOpen(false);
                        }}
                        onMouseEnter={() => setPreviewModelId(model.id)}
                      >
                        <button
                          type="button"
                          className="gap-2 group/item flex flex-row items-center w-full"
                        >
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
                              value === model.id ? "opacity-100" : "opacity-0",
                            )}
                          >
                            <Check />
                          </div>
                        </button>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>

          {previewModel && (
            <ModelPreviewCard model={previewModel} className="w-72" />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
