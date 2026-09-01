import type { AvailableModel } from "@/lib/services/models/queries";
import { addAppUtm } from "@/utils/url";
import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";
import { SquareArrowOutUpRightIcon } from "lucide-react";

export type ModelPreviewCardProps = {
  model: AvailableModel;
} & React.ComponentPropsWithoutRef<"div">;

// Pinned "en-US" rather than the host locale (`undefined`), matching the
// repo's established SSR-hydration-safety convention (message-usage.tsx):
// the server and the browser must format identically, or React flags a
// hydration mismatch on any non-en-US client. `formatDate` also pins
// `timeZone: "UTC"` — `knowledgeCutoff`/`releasedAt` are date-only ISO
// strings, which `new Date()` parses at UTC midnight; a host-timezone format
// would otherwise shift the day for any UTC-negative client, on top of the
// same locale mismatch. Exported for unit tests (docs/testing.md rule 5).

export function formatTokens(tokens: number): string {
  return Intl.NumberFormat("en-US", { style: "decimal" }).format(tokens);
}

export function formatUsd(amount: number): string {
  return Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Context window + the three per-million-token prices — grouped since they
 *  share the same currency/number formatting. */
function ModelPricingRows({ model }: { model: AvailableModel }) {
  const priceInputPerMillion = model.pricingUsdPer1M?.input;
  const priceCachedInputPerMillion = model.pricingUsdPer1M?.cachedInput;
  const priceOutputPerMillion = model.pricingUsdPer1M?.output;

  return (
    <>
      <div className="flex justify-between">
        <dt className="font-medium">Context</dt>
        <dd className="text-end">
          {formatTokens(model.contextWindowTokens)} tokens
        </dd>
      </div>

      {priceInputPerMillion !== undefined && (
        <div className="flex justify-between">
          <dt className="font-medium">Input</dt>
          <dd className="text-end">
            {formatUsd(priceInputPerMillion)} / 1M tokens
          </dd>
        </div>
      )}

      {priceCachedInputPerMillion !== undefined && (
        <div className="flex justify-between">
          <dt className="font-medium">Cached input</dt>
          <dd className="text-end">
            {formatUsd(priceCachedInputPerMillion)} / 1M tokens
          </dd>
        </div>
      )}

      {priceOutputPerMillion !== undefined && (
        <div className="flex justify-between">
          <dt className="font-medium">Output</dt>
          <dd className="text-end">
            {formatUsd(priceOutputPerMillion)} / 1M tokens
          </dd>
        </div>
      )}
    </>
  );
}

/** Dates + identity — grouped separately from pricing since they don't share
 *  its formatting or its "only if priced" gating. */
function ModelMetaRows({ model }: { model: AvailableModel }) {
  return (
    <>
      {model.knowledgeCutoff && (
        <div className="flex justify-between">
          <dt className="font-medium">Knowledge Cutoff</dt>
          <dd className="text-end">{formatDate(model.knowledgeCutoff)}</dd>
        </div>
      )}

      {model.releasedAt && (
        <div className="flex justify-between">
          <dt className="font-medium">Released</dt>
          <dd className="text-end">{formatDate(model.releasedAt)}</dd>
        </div>
      )}

      <div className="flex justify-between items-baseline">
        <dt className="font-medium">ID</dt>
        <dd className="text-end text-muted-foreground truncate text-xs font-mono">
          {model.id}
        </dd>
      </div>
    </>
  );
}

/** The card's external-link footer — a distinct concern (outbound links,
 *  its own conditional visibility) from the `<dl>` details above it. */
function ModelPreviewLinks({ model }: { model: AvailableModel }) {
  if (!model.apiDocs && !model.modelPage) return null;

  return (
    <>
      <Separator className="mt-auto" />
      <div className="flex flex-row justify-between">
        {model.apiDocs && (
          <a
            href={addAppUtm(model.apiDocs)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-xs hover:underline"
          >
            <span>API Docs</span>
            <SquareArrowOutUpRightIcon className="size-3" />
          </a>
        )}

        {model.modelPage && (
          <a
            href={addAppUtm(model.modelPage)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-xs hover:underline"
          >
            <span>Model Page</span>
            <SquareArrowOutUpRightIcon className="size-3" />
          </a>
        )}
      </div>
    </>
  );
}

export function ModelPreviewCard({
  model,
  className,
  ...props
}: ModelPreviewCardProps) {
  return (
    <div {...props} className={cn("p-3 flex flex-col gap-2", className)}>
      <div className="flex items-center gap-3">
        <h3 className="font-medium">{model.name ?? model.id}</h3>
      </div>

      {model.description && (
        <p className="text-muted-foreground text-sm">{model.description}</p>
      )}

      <dl className="flex flex-col gap-2 text-sm">
        <ModelPricingRows model={model} />
        <ModelMetaRows model={model} />
      </dl>

      <ModelPreviewLinks model={model} />
    </div>
  );
}
