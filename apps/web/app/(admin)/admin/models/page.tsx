"use client";

import type { ReactNode } from "react";

import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";

import { SectionPage } from "@/app/shell/section-rail";
import type { ModelsResponse } from "@/lib/api/generated/models";
import {
  modelDisplayName,
  useModelsQuery,
} from "@/lib/services/models/queries";

import { ModelDirectory } from "./components/model-directory";
import { RoleChains } from "./components/role-chains";

/*
 * A read-only view of the model catalog as `GET /api/v1/models` serves it to
 * every signed-in user: the default selector, the model roles with their
 * candidates, and each model's declared limits and prices. Provider entries
 * (destinations, wires, credentials) are deliberately absent: no endpoint
 * exposes them, and none can until the instance has an administrator role
 * to gate it.
 */

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

function Catalog({ data }: { data: ModelsResponse }) {
  return (
    <>
      <CatalogSection
        title="Model roles"
        detail="Named fallback chains a send can name as @role. A failed request moves down the chain."
      >
        <RoleChains roles={data.roles} models={data.models} />
      </CatalogSection>
      <CatalogSection
        title={`Models (${String(data.models.length)})`}
        detail={`Every model the catalog offers, by provider. New chats use ${modelDisplayName(data.defaultSelector, data.models)} unless the owner picks another.`}
      >
        <ModelDirectory data={data} />
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
