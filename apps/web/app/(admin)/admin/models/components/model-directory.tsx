"use client";

import { useState } from "react";
import { BotIcon, ChevronRightIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";

import {
  ModelMetaRows,
  ModelPreviewLinks,
  ModelPricingRows,
} from "@/components/ai/model-preview-card";
import { SearchFilterInput } from "@/components/search-filter-input";
import type {
  AvailableModelResponse,
  ModelsResponse,
} from "@/lib/api/generated/models";

/*
 * Every model the catalog offers, grouped by provider and searchable: the
 * row the composer's model picker shows (name, description), what an
 * operator also needs (whether it is the default, which roles use it and at
 * which step), and, opened, the same details the picker's preview card
 * shows plus inputs and effort levels.
 */

/** The provider segment of a model id: `system:<provider>:<model>`. */
function providerOf(model: AvailableModelResponse): string {
  return model.id.split(":")[1] ?? model.source;
}

/** "@small · 2" for each role that lists the model, by step. */
function roleUses(
  model: AvailableModelResponse,
  roles: ModelsResponse["roles"],
): Array<string> {
  return roles.flatMap((role) =>
    role.candidates.flatMap((candidate, index) =>
      candidate.modelId === model.id
        ? [`${role.selector} · ${String(index + 1)}`]
        : [],
    ),
  );
}

function ModelDetails({ model }: { model: AvailableModelResponse }) {
  return (
    <div className="space-y-2 pt-2 pb-1 pl-11">
      <dl className="flex flex-col gap-2 text-sm">
        <ModelPricingRows model={model} />
        <div className="flex justify-between">
          <dt className="font-medium">Inputs</dt>
          <dd className="text-end">{model.input.join(", ")}</dd>
        </div>
        {model.reasoning === undefined ? null : (
          <div className="flex justify-between">
            <dt className="font-medium">Effort</dt>
            <dd className="text-end">
              {model.reasoning.effortLevels.map((l) => l.value).join(" · ")}
            </dd>
          </div>
        )}
        <ModelMetaRows model={model} />
      </dl>
      <ModelPreviewLinks model={model} />
    </div>
  );
}

/** The row's visible line: what the composer's picker shows, and the
 *  default and role uses an operator needs. */
function ModelSummary({
  model,
  isDefault,
  uses,
}: {
  model: AvailableModelResponse;
  isDefault: boolean;
  uses: Array<string>;
}) {
  return (
    <>
      <Avatar>
        <AvatarFallback>
          <BotIcon className="size-4" />
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{model.name ?? model.id}</span>
        {model.description === undefined ? null : (
          <span className="block truncate text-xs text-muted-foreground">
            {model.description}
          </span>
        )}
      </span>
      <span className="hidden shrink-0 flex-wrap justify-end gap-1 sm:flex">
        {isDefault ? <Badge>Default</Badge> : null}
        {uses.map((use) => (
          <Badge key={use} variant="outline">
            {use}
          </Badge>
        ))}
      </span>
      <ChevronRightIcon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/model:rotate-90"
      />
    </>
  );
}

function ModelRow(props: {
  model: AvailableModelResponse;
  isDefault: boolean;
  uses: Array<string>;
}) {
  return (
    <Collapsible render={<li className="py-2.5 first:pt-0 last:pb-0" />}>
      <CollapsibleTrigger
        render={
          <button
            type="button"
            aria-label={`${props.model.name ?? props.model.id} details`}
            className="group/model flex w-full items-center gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        }
      >
        <ModelSummary {...props} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ModelDetails model={props.model} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function groupByProvider(models: ReadonlyArray<AvailableModelResponse>) {
  const groups = new Map<string, Array<AvailableModelResponse>>();

  for (const model of models) {
    const key = providerOf(model);
    groups.set(key, [...(groups.get(key) ?? []), model]);
  }

  return [...groups.entries()];
}

function matches(model: AvailableModelResponse, query: string): boolean {
  const q = query.trim().toLowerCase();

  return (
    q === "" ||
    [model.id, model.name ?? "", model.description ?? ""].some((text) =>
      text.toLowerCase().includes(q),
    )
  );
}

export function ModelDirectory({ data }: { data: ModelsResponse }) {
  const [query, setQuery] = useState("");
  const shown = data.models.filter((model) => matches(model, query));

  // A role default (`@small`) starts new chats on its primary candidate.
  const defaultId =
    data.roles.find((role) => role.selector === data.defaultSelector)
      ?.candidates[0]?.modelId ?? data.defaultSelector;

  return (
    <div className="space-y-4">
      <SearchFilterInput
        value={query}
        onChange={setQuery}
        placeholder="Search models…"
        aria-label="Search models"
      />
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No models match.</p>
      ) : null}
      {groupByProvider(shown).map(([provider, models]) => (
        <section key={provider} className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            {provider} · {models.length}
          </h3>
          <ul className="divide-y">
            {models.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                isDefault={model.id === defaultId}
                uses={roleUses(model, data.roles)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
