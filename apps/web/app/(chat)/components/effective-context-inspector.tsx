"use client";

import { FileSearchIcon, LoaderCircleIcon } from "lucide-react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet";

import { useRunContextReceipt } from "@/lib/services/chat/runs";

export function EffectiveContextAction({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="xs" onClick={onClick}>
      <FileSearchIcon data-icon="inline-start" aria-hidden="true" />
      Effective context
    </Button>
  );
}

function promptSourceLabel(source: "project_default" | "model_override") {
  return source === "model_override"
    ? "Model-specific override"
    : "Project default";
}

export function EffectiveContextInspector({
  runId,
  open,
  onOpenChange,
}: {
  runId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const receipt = useRunContextReceipt(runId, open);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>Effective context</SheetTitle>
          <SheetDescription>
            Immutable system prompt and tool declarations used for this run.
          </SheetDescription>
        </SheetHeader>

        {receipt.isPending ? (
          <div className="flex items-center gap-2 px-4 text-sm text-muted-foreground">
            <LoaderCircleIcon
              data-icon="inline-start"
              aria-hidden="true"
              className="animate-spin"
            />
            Loading effective context…
          </div>
        ) : receipt.isError ? (
          <Alert variant="destructive" className="mx-4 w-auto">
            <AlertTitle>Effective context unavailable</AlertTitle>
            <AlertDescription>
              The receipt could not be loaded or is not available to this user.
            </AlertDescription>
          </Alert>
        ) : receipt.data ? (
          <div className="flex flex-col gap-6 px-4 pb-6">
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Model</dt>
              <dd className="break-all font-mono">{receipt.data.modelId}</dd>
              <dt className="text-muted-foreground">Prompt source</dt>
              <dd>{promptSourceLabel(receipt.data.promptSource)}</dd>
              <dt className="text-muted-foreground">Snapshot</dt>
              <dd>
                <time dateTime={receipt.data.createdAt}>
                  {receipt.data.createdAt}
                </time>
              </dd>
              <dt className="text-muted-foreground">Content hash</dt>
              <dd className="break-all font-mono text-xs">
                {receipt.data.contentHash}
              </dd>
            </dl>

            <section aria-labelledby="effective-prompt-heading">
              <h3
                id="effective-prompt-heading"
                className="mb-2 text-sm font-medium"
              >
                Complete system prompt
              </h3>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border bg-muted/40 p-3 font-mono text-xs">
                {receipt.data.systemPrompt}
              </pre>
            </section>

            <section aria-labelledby="effective-tools-heading">
              <h3
                id="effective-tools-heading"
                className="mb-2 text-sm font-medium"
              >
                Advertised tools
              </h3>
              {receipt.data.tools.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No tools were advertised to this run.
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {receipt.data.tools.map((tool) => (
                    <article key={tool.id} className="border p-3">
                      <h4 className="break-all font-mono text-sm font-medium">
                        {tool.id}
                      </h4>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {tool.description}
                      </p>
                      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words bg-muted/40 p-3 font-mono text-xs">
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
