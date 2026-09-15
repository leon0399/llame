"use client";

import { FileSearchIcon, LoaderCircleIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet";

import {
  useRunContextReceipt,
  type RunContextReceipt,
} from "@/lib/services/chat/runs";

export function EffectiveContextAction({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="xs" onClick={onClick}>
      <FileSearchIcon data-icon="inline-start" aria-hidden="true" />
      System prompt
    </Button>
  );
}

function promptSourceLabel(source: "project_default" | "model_override") {
  return source === "model_override"
    ? "Model-specific override"
    : "Project default";
}

function EffectiveContextLoading() {
  return (
    <div className="flex items-center justify-center p-6">
      <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function EffectiveContextError() {
  return (
    <p className="p-4 text-sm text-muted-foreground">
      Could not load the receipt for this run.
    </p>
  );
}

function EffectiveContextMetadata({ data }: { data: RunContextReceipt }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Model</dt>
      <dd className="break-all font-mono">{data.modelId}</dd>
      {data.effort !== undefined ? (
        <>
          <dt className="text-muted-foreground">Effort</dt>
          <dd className="break-all font-mono">{data.effort}</dd>
        </>
      ) : null}
      <dt className="text-muted-foreground">State</dt>
      <dd className="font-mono">{data.state}</dd>
      {data.activeAttemptId ? (
        <>
          <dt className="text-muted-foreground">Active attempt</dt>
          <dd className="break-all font-mono text-xs">
            {data.activeAttemptId}
          </dd>
        </>
      ) : null}
      {data.completedAttemptId ? (
        <>
          <dt className="text-muted-foreground">Completed attempt</dt>
          <dd className="break-all font-mono text-xs">
            {data.completedAttemptId}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

function AttemptReceipt({
  receipt,
}: {
  receipt: RunContextReceipt["receipts"][number];
}) {
  return (
    <article className="border p-3">
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Attempt</dt>
        <dd className="break-all font-mono text-xs">{receipt.attemptId}</dd>
        <dt className="text-muted-foreground">Source</dt>
        <dd>{promptSourceLabel(receipt.promptSource)}</dd>
        <dt className="text-muted-foreground">Hash</dt>
        <dd className="break-all font-mono text-xs">{receipt.promptHash}</dd>
        <dt className="text-muted-foreground">Prepared</dt>
        <dd>
          <time dateTime={receipt.createdAt}>{receipt.createdAt}</time>
        </dd>
      </dl>
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words border bg-muted/40 p-3 font-mono text-xs">
        {receipt.systemPrompt}
      </pre>
    </article>
  );
}

function EffectiveContextData({ data }: { data: RunContextReceipt }) {
  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      <EffectiveContextMetadata data={data} />
      {data.receipts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {data.state === "pending"
            ? "This run is queued; no attempt has prepared a prompt yet."
            : "No system prompt receipt was produced for this run."}
        </p>
      ) : (
        <section aria-labelledby="receipts-heading">
          <h3 id="receipts-heading" className="mb-2 text-sm font-medium">
            System prompt receipts ({data.receipts.length})
          </h3>
          <div className="flex flex-col gap-4">
            {data.receipts.map((r) => (
              <AttemptReceipt key={r.attemptId} receipt={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function EffectiveContextBody({
  receipt,
}: {
  receipt: ReturnType<typeof useRunContextReceipt>;
}) {
  if (receipt.isPending) return <EffectiveContextLoading />;
  if (receipt.isError) return <EffectiveContextError />;
  return <EffectiveContextData data={receipt.data} />;
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
      <SheetContent className="overflow-auto sm:max-w-lg">
        <SheetHeader className="px-4">
          <SheetTitle>System prompt receipt</SheetTitle>
          <SheetDescription>
            The rendered system prompt each execution attempt prepared.
          </SheetDescription>
        </SheetHeader>
        <EffectiveContextBody receipt={receipt} />
      </SheetContent>
    </Sheet>
  );
}
