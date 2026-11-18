"use client";

import type { ReactElement, ReactNode } from "react";
import { z } from "zod";

import { Card, CardContent } from "@workspace/ui/components/card";
import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";

/** A literal, or a JSON Pointer into the surface's data model. */
const dynamicString = z.union([
  z.string().transform((literal) => ({ literal })),
  z.object({ path: z.string() }),
]);

/** Fixed children, or one template repeated for each item of a data array. */
const childList = z.union([
  z.array(z.string()),
  z.object({ componentId: z.string(), path: z.string() }),
]);

const justify = z.enum([
  "start",
  "center",
  "end",
  "spaceBetween",
  "spaceAround",
  "spaceEvenly",
  "stretch",
]);

const align = z.enum(["start", "center", "end", "stretch"]);

const componentSchema = z.discriminatedUnion("component", [
  z.object({
    id: z.string(),
    component: z.literal("Text"),
    text: dynamicString,
    variant: z
      .enum(["h1", "h2", "h3", "h4", "h5", "caption", "body"])
      .optional(),
  }),
  z.object({
    id: z.string(),
    component: z.literal("Row"),
    children: childList,
    justify: justify.optional(),
    align: align.optional(),
  }),
  z.object({
    id: z.string(),
    component: z.literal("Column"),
    children: childList,
    justify: justify.optional(),
    align: align.optional(),
  }),
  z.object({
    id: z.string(),
    component: z.literal("List"),
    children: childList,
    direction: z.enum(["vertical", "horizontal"]).optional(),
    align: align.optional(),
  }),
  z.object({ id: z.string(), component: z.literal("Card"), child: z.string() }),
  z.object({
    id: z.string(),
    component: z.literal("Divider"),
    axis: z.enum(["horizontal", "vertical"]).optional(),
  }),
]);

/**
 * One A2UI v0.9 surface as the `render_ui` tool accepts it: a flat component
 * list with a `root`, and the data model its bindings read. The catalog is the
 * display-only subset the tool offers.
 */
export const a2uiSurfaceSchema = z.object({
  components: z.array(componentSchema).min(1),
  data: z.record(z.string(), z.json()).optional(),
});

export type A2uiSurfaceSpec = z.infer<typeof a2uiSurfaceSchema>;

type Component = A2uiSurfaceSpec["components"][number];

type Json = z.infer<ReturnType<typeof z.json>>;

/** The values a `Text` shows; an object or a list has no text form. */
const scalar = z.union([z.string(), z.number(), z.boolean()]);

const TEXT_VARIANT = {
  h1: "font-semibold text-2xl",
  h2: "font-semibold text-xl",
  h3: "font-semibold text-lg",
  h4: "font-semibold text-base",
  h5: "font-semibold text-sm",
  caption: "text-muted-foreground text-xs",
  body: "text-sm",
} as const;

const JUSTIFY = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  spaceBetween: "justify-between",
  spaceAround: "justify-around",
  spaceEvenly: "justify-evenly",
  stretch: "justify-stretch",
} as const;

const ALIGN = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
} as const;

/** The value a path names: a JSON Pointer from the data model when it starts
 *  with `/`, else a pointer from the item a repeated component stands for. */
function resolvePath(path: string, data: Json, item: Json): Json | undefined {
  const absolute = path.startsWith("/");
  let value: Json | undefined = absolute ? data : item;

  for (const token of path.split("/").slice(absolute ? 1 : 0)) {
    if (token === "") continue;
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");

    if (Array.isArray(value)) {
      value = value[Number(key)];
    } else if (value instanceof Object) {
      // Own keys only: a path must not reach the object's prototype.
      value = Object.hasOwn(value, key) ? value[key] : undefined;
    } else {
      return undefined;
    }

    if (value === undefined) return undefined;
  }

  return value;
}

/** How many components one surface renders. The api bounds what it accepts,
 *  but a stored surface is rendered as it is, and nested repetition multiplies:
 *  past this the surface stops rather than freezing the page. */
const MAX_RENDERED_COMPONENTS = 1000;

type RenderScope = {
  byId: ReadonlyMap<string, Component>;
  data: Json;
  /** The item a repeated component stands for; the data model otherwise. */
  item: Json;
  /** The ids being rendered above this one: a component that names an
   *  ancestor as its child would never finish rendering. */
  ancestors: ReadonlySet<string>;
  /** What is left of `MAX_RENDERED_COMPONENTS`, shared by the whole surface. */
  budget: { remaining: number };
};

function renderChildren(
  children: Extract<Component, { children: unknown }>["children"],
  scope: RenderScope,
): ReactNode {
  if (Array.isArray(children)) {
    return children.map((id) => renderComponent(id, scope, id));
  }

  const items = resolvePath(children.path, scope.data, scope.item);

  // No more items than the surface can still render.
  return Array.isArray(items)
    ? items
        .slice(0, scope.budget.remaining)
        .map((item, index) =>
          renderComponent(children.componentId, { ...scope, item }, index),
        )
    : null;
}

function renderText(
  node: Extract<Component, { component: "Text" }>,
  scope: RenderScope,
  key: string | number,
): ReactNode {
  const value =
    "literal" in node.text
      ? node.text.literal
      : resolvePath(node.text.path, scope.data, scope.item);

  const shown = scalar.safeParse(value);

  return (
    <p key={key} className={TEXT_VARIANT[node.variant ?? "body"]}>
      {shown.success ? String(shown.data) : ""}
    </p>
  );
}

function renderLayout(
  node: Extract<Component, { children: unknown }>,
  scope: RenderScope,
  key: string | number,
): ReactNode {
  const horizontal =
    node.component === "Row" ||
    (node.component === "List" && node.direction === "horizontal");

  return (
    <div
      key={key}
      className={cn(
        "flex min-w-0",
        horizontal ? "flex-row flex-wrap gap-3" : "flex-col gap-2",
        node.component === "List"
          ? undefined
          : JUSTIFY[node.justify ?? "start"],
        ALIGN[node.align ?? "stretch"],
      )}
    >
      {renderChildren(node.children, scope)}
    </div>
  );
}

function renderComponent(
  id: string,
  scope: RenderScope,
  key: string | number,
): ReactNode {
  const node = scope.byId.get(id);
  const { budget } = scope;

  if (node === undefined || scope.ancestors.has(id) || budget.remaining <= 0) {
    return null;
  }

  budget.remaining -= 1;
  const inner = { ...scope, ancestors: new Set([...scope.ancestors, id]) };

  switch (node.component) {
    case "Text":
      return renderText(node, scope, key);

    case "Divider":
      return (
        <Separator
          key={key}
          orientation={node.axis === "vertical" ? "vertical" : "horizontal"}
        />
      );

    case "Card":
      return (
        <Card key={key} size="sm">
          <CardContent>
            {renderComponent(node.child, inner, "child")}
          </CardContent>
        </Card>
      );

    default:
      return renderLayout(node, inner, key);
  }
}

/**
 * A2uiSurface renders one agent-authored surface with this package's own
 * components, so it follows the installation's theme rather than the agent's
 * taste. It renders nothing it does not know and nothing without end: an
 * unknown id, a component that names one of its own ancestors, or a component
 * past the surface's budget paints nothing.
 *
 * @summary for a display-only A2UI v0.9 surface from the render_ui tool
 */
export function A2uiSurface({
  surface,
}: {
  /** The parsed surface; see `a2uiSurfaceSchema`. */
  surface: A2uiSurfaceSpec;
}): ReactElement {
  const data = surface.data ?? {};

  return (
    <div data-slot="a2ui-surface" className="not-prose flex w-full flex-col">
      {renderComponent(
        "root",
        {
          byId: new Map(surface.components.map((node) => [node.id, node])),
          data,
          item: data,
          ancestors: new Set(),
          budget: { remaining: MAX_RENDERED_COMPONENTS },
        },
        "root",
      )}
    </div>
  );
}
