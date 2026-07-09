"use client";

import * as React from "react";
import { BotIcon, Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/button";
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

export function ModelSelector({
  className,
  popoverAlign = "start",
}: {
  className?: string;
  popoverAlign?: React.ComponentProps<typeof PopoverContent>["align"];
}) {
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

  const [previewModelId, setPreviewModelId] = React.useState<string>(value);
  React.useEffect(() => {
    setPreviewModelId(value);
  }, [value]);

  const previewModel = React.useMemo(
    () => models.find((model) => model.id === previewModelId),
    [models, previewModelId],
  );

  const selectedLabel = (() => {
    if (isPending) return "Loading models";
    if (isError) return "Models unavailable";
    if (!value) return "Select a model";
    return modelDisplayName(value, models);
  })();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          disabled={isPending || isError || models.length === 0}
          className={className}
        >
          {selectedLabel}
          <ChevronsUpDown className="ml-auto opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className={cn("p-0", previewModel ? "w-[36rem]" : "w-72")}
        align={popoverAlign}
      >
        <div className="relative flex flex-row divide-x divide-border">
          <Command className="rounded-e-none w-72">
            <CommandInput placeholder="Search model..." className="h-9" />
            <CommandList>
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
