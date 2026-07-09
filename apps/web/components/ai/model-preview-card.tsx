import type { AvailableModel } from "@/lib/services/models/queries";
import { addAppUtm } from "@/utils/url";
import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";
import { SquareArrowOutUpRightIcon } from "lucide-react";

export type ModelPreviewCardProps = {
  model: AvailableModel;
} & React.ComponentPropsWithoutRef<"div">;

export function ModelPreviewCard({
  model,
  className,
  ...props
}: ModelPreviewCardProps) {
  const displayLinks = model.apiDocs || model.modelPage;

  const priceInputPerMillion = model.pricingUsdPer1M?.input;
  const priceCachedInputPerMillion = model.pricingUsdPer1M?.cachedInput;
  const priceOutputPerMillion = model.pricingUsdPer1M?.output;

  return (
    <div {...props} className={cn("p-3 flex flex-col gap-2", className)}>
      <div className="flex items-center gap-3">
        <h3 className="font-medium">{model.name ?? model.id}</h3>
      </div>

      {model.description && (
        <p className="text-muted-foreground text-sm">{model.description}</p>
      )}

      <dl className="flex flex-col gap-2 sm:grid-cols-2 text-sm">
        <div className="flex justify-between">
          <dt className="font-medium">Context</dt>
          <dd className="text-end">
            {Intl.NumberFormat(undefined, { style: "decimal" }).format(
              model.contextWindowTokens,
            )}{" "}
            tokens
          </dd>
        </div>

        {priceInputPerMillion !== undefined && (
          <div className="flex justify-between">
            <dt className="font-medium">Input</dt>
            <dd className="text-end">
              {Intl.NumberFormat(undefined, {
                style: "currency",
                currency: "USD",
              }).format(priceInputPerMillion)}{" "}
              / 1M tokens
            </dd>
          </div>
        )}

        {priceCachedInputPerMillion !== undefined && (
          <div className="flex justify-between">
            <dt className="font-medium">Cached input</dt>
            <dd className="text-end">
              {Intl.NumberFormat(undefined, {
                style: "currency",
                currency: "USD",
              }).format(priceCachedInputPerMillion)}{" "}
              / 1M tokens
            </dd>
          </div>
        )}

        {priceOutputPerMillion !== undefined && (
          <div className="flex justify-between">
            <dt className="font-medium">Output</dt>
            <dd className="text-end">
              {Intl.NumberFormat(undefined, {
                style: "currency",
                currency: "USD",
              }).format(priceOutputPerMillion)}{" "}
              / 1M tokens
            </dd>
          </div>
        )}

        {model.knowledgeCutoff && (
          <div className="flex justify-between">
            <dt className="font-medium">Knowledge Cutoff</dt>
            <dd className="text-end">
              {new Date(model.knowledgeCutoff).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </dd>
          </div>
        )}

        {model.releasedAt && (
          <div className="flex justify-between">
            <dt className="font-medium">Released</dt>
            <dd className="text-end">
              {new Date(model.releasedAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </dd>
          </div>
        )}

        <div className="flex justify-between items-baseline">
          <dt className="font-medium">ID</dt>
          <dd className="text-end text-muted-foreground truncate text-xs font-mono">
            {model.id}
          </dd>
        </div>
      </dl>

      {displayLinks && (
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
      )}
    </div>
  );
}
