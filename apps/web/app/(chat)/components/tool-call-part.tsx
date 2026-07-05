"use client";

import { useState } from "react";
import { ChevronRightIcon, WrenchIcon } from "lucide-react";

import { Badge } from "@workspace/ui/components/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { cn } from "@workspace/ui/lib/utils";

/**
 * A `dynamic-tool` UI message part (tool-calling loop): the agent's tool use,
 * made visible. Collapsed by default — a chip showing the tool name and
 * running/done state; expanded shows the input arguments and the tool result.
 */
export function ToolCallPart({
  toolName,
  state,
  input,
  output,
}: {
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
}) {
  const [open, setOpen] = useState(false);
  const done = state === "output-available" || state === "output-error";

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-border bg-muted/40 my-1 w-full rounded-lg border"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-sm">
        <ChevronRightIcon
          className={cn(
            "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <WrenchIcon className="text-muted-foreground h-4 w-4 shrink-0" />
        <span className="font-medium">{toolName}</span>
        <Badge variant={done ? "secondary" : "outline"} className="ml-auto">
          {done ? "done" : "running…"}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-3 pb-3">
        {input !== undefined && (
          <div>
            <p className="text-muted-foreground mb-1 text-xs">Input</p>
            <pre className="bg-background overflow-x-auto rounded-md p-2 text-xs">
              {safeStringify(input)}
            </pre>
          </div>
        )}
        {output !== undefined && (
          <div>
            <p className="text-muted-foreground mb-1 text-xs">Result</p>
            <pre className="bg-background overflow-x-auto rounded-md p-2 text-xs">
              {safeStringify(output)}
            </pre>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
