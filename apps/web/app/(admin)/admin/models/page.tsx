"use client";

import type { ReactNode } from "react";

import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";

import { SectionPage } from "@/app/shell/section-rail";
import { formatTokens, formatUsd } from "@/components/ai/model-preview-card";
import type {
  AvailableModelResponse,
  ModelRoleResponse,
  ModelsResponse,
} from "@/lib/api/generated/models";
import {
  modelDisplayName,
  useModelsQuery,
} from "@/lib/services/models/queries";

/*
 * A read-only view of the model catalog as `GET /api/v1/models` serves it to
 * every signed-in user: the default selector, the model roles with their
 * candidates, and each model's declared limits and prices. Provider entries
 * (destinations, wires, credentials) are deliberately absent: no endpoint
 * exposes them, and none can until the instance has an administrator role
 * to gate it.
 */

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

/** One titled part of the catalog, its content in a card. */
function CatalogSection({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      <Card>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}

function RoleLine({
  role,
  models,
}: {
  role: ModelRoleResponse;
  models: ModelsResponse["models"];
}) {
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
      <code className="w-40 shrink-0 font-mono text-sm">{role.selector}</code>
      <ol className="flex min-w-0 flex-wrap items-center gap-1.5">
        {role.candidates.map((candidate, index) => (
          <li
            key={`${candidate.modelId}:${String(index)}`}
            className="flex items-center gap-1.5 text-sm"
          >
            {index > 0 && (
              <span aria-hidden className="text-muted-foreground">
                →
              </span>
            )}
            <span>{modelDisplayName(candidate.modelId, models)}</span>
            {candidate.effort === undefined ? null : (
              <Chip>{candidate.effort}</Chip>
            )}
            {candidate.paid ? <Chip>paid fallback</Chip> : null}
          </li>
        ))}
      </ol>
    </li>
  );
}

/** A display name with the id the configuration and selectors use. */
function NamedId({ name, id }: { name: string; id: string }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-sm font-medium">{name}</span>
      <code className="font-mono text-xs text-muted-foreground">{id}</code>
    </p>
  );
}

function priceText(model: AvailableModelResponse): string | null {
  const price = model.pricingUsdPer1M;

  if (price?.input === undefined || price.output === undefined) return null;

  if (price.input === 0 && price.output === 0) return "Free";

  return `${formatUsd(price.input)} in · ${formatUsd(price.output)} out per 1M`;
}

function ModelLine({ model }: { model: AvailableModelResponse }) {
  const price = priceText(model);

  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <NamedId name={model.name ?? model.id} id={model.id} />
      <div className="flex flex-wrap gap-1.5">
        <Chip>{formatTokens(model.contextWindowTokens)} context</Chip>
        <Chip>{model.input.join(", ")}</Chip>
        {model.reasoning === undefined ? null : (
          <Chip>
            effort{" "}
            {model.reasoning.effortLevels
              .map((level) => level.value)
              .join(" · ")}
          </Chip>
        )}
        {price === null ? null : <Chip>{price}</Chip>}
      </div>
    </li>
  );
}

function Catalog({ data }: { data: ModelsResponse }) {
  return (
    <>
      <CatalogSection
        title="Default"
        detail="What a new chat sends to when the owner picks nothing."
      >
        <NamedId
          name={modelDisplayName(data.defaultSelector, data.models)}
          id={data.defaultSelector}
        />
      </CatalogSection>
      <CatalogSection
        title="Model roles"
        detail="Named, ordered candidate lists a send can name as @role. Failover walks them left to right."
      >
        {data.roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No roles configured.</p>
        ) : (
          <ul className="divide-y">
            {data.roles.map((role) => (
              <RoleLine key={role.selector} role={role} models={data.models} />
            ))}
          </ul>
        )}
      </CatalogSection>
      <CatalogSection
        title={`Models (${String(data.models.length)})`}
        detail="Every model entry the catalog offers, with its declared context, inputs, effort levels and prices."
      >
        <ul className="divide-y">
          {data.models.map((model) => (
            <ModelLine key={model.id} model={model} />
          ))}
        </ul>
      </CatalogSection>
    </>
  );
}

function ModelsBody() {
  const { data, isPending, isError } = useModelsQuery();

  if (isPending) return <Skeleton className="h-64" />;

  if (isError || data === undefined) {
    return (
      <Alert variant="destructive">
        <AlertTitle>The model catalog could not be loaded.</AlertTitle>
      </Alert>
    );
  }

  return <Catalog data={data} />;
}

export default function AdminModelsPage() {
  return (
    <SectionPage
      title="Models"
      description="The model catalog this instance serves, from the instance configuration. Read-only."
    >
      <ModelsBody />
    </SectionPage>
  );
}
