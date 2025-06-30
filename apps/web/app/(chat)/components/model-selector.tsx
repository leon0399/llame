"use client"

import * as React from "react"
import { BotIcon, Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"

type Model = {
  id: string
  label?: string
  description?: string
  tags?: string[]
}

const models: Model[] = [
  {
    id: "gpt-4o",
    label: "GPT-4o",
    description: 'Great for most tasks',
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
  },
  {
    id: "gpt-4.5-preview-2025-02-27",
    label: "GPT-4.5",
    tags: ["Research Preview"],
  },
  {
    id: "o3-pro",
  },
  {
    id: "o3",
  },
  {
    id: "o4-mini",
  },
  {
    id: "o3-mini",
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1-mini",
  },
  {
    id: "claude-opus-4-0",
    label: "Claude Opus 4",
  },
  {
    id: "claude-sonnet-4-0",
    label: "Claude Sonnet 4",
  },
  {
    id: 'claude-3-7-sonnet-latest',
    label: 'Claude 3.7 Sonnet',
  },
  {
    id: "claude-3-5-sonnet-latest",
    label: "Claude 3.5 Sonnet",
  },
  {
    id: "claude-3-5-haiku",
    label: "Claude 3.5 Haiku",
  }
]

export function ModelSelector({
  className,
  popoverAlign = "start",
}: {
  className?: string
  popoverAlign?: React.ComponentProps<typeof PopoverContent>["align"]
}) {
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState("")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className={className}
        >
          {value
            ? models.find((model) => model.id === value)?.label
            : "Select a model"}
          <ChevronsUpDown className="ml-auto opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="p-0" align={popoverAlign}>
        <Command>
          <CommandInput placeholder="Search model..." className="h-9" />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            <CommandGroup>
              {models.map((model) => (
                <CommandItem
                  key={model.id}
                  value={model.id}
                  onSelect={(currentValue) => {
                    setValue(currentValue === value ? "" : currentValue)
                    setOpen(false)
                  }}
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

                    <div className="flex flex-col gap-1 items-start">
                      <div>{model.label || model.id}</div>
                      {model.description && (
                        <div className="text-xs text-muted-foreground">
                          {model.description}
                        </div>
                      )}
                    </div>

                    <div className={cn(
                      "ml-auto text-foreground dark:text-foreground",
                      value === model.id ? "opacity-100" : "opacity-0"
                    )}>
                      <Check />
                    </div>
                  </button>                  
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
