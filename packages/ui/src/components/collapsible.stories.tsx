import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  FileIcon,
  FolderIcon,
  MaximizeIcon,
  MinimizeIcon,
} from "lucide-react";
import { expect, waitFor } from "storybook/test";

import { Button } from "./button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible.js";
import { Field, FieldGroup, FieldLabel } from "./field.js";
import { Input } from "./input.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.js";

// Every story in this file is transcribed verbatim from the shadcn Collapsible
// docs examples (https://ui.shadcn.com/docs/components/base/collapsible), so
// the file carries the "shadcn-example" provenance tag on each transcribed story. The
// source is `apps/v4/examples/radix/collapsible-<x>.tsx` on GitHub main, the
// files the docs' "Radix UI" tab renders; these compose the standard Radix
// Collapsible API our collapsible.tsx fully exports, so all four non-RTL
// examples are compatible. RTL is skipped by convention.
//
// Naming: the docs page has both a lead, unanchored preview
// (`collapsible-demo`, an "Order #4189" disclosure) AND a separately anchored
// "## Basic" example (`collapsible-basic`, a "Product details" panel) with
// genuinely different content — unlike accordion-demo/accordion-basic, which
// were identical and collapsed to one story. The lead demo is named `Basic`
// here (matching the select/avatar-demo precedent for a page's lead example);
// the distinct "## Basic" anchor content is named `ProductDetails` instead,
// since `Basic` was already taken.
//
// Three small adaptations beyond import/icon/a11y-name normalization:
// - `collapsible-file-tree` and `collapsible-settings` pass their outer
//   `Card` a `size="sm"` prop; it had lagged upstream in our card.tsx and is
//   now backported, so the prop is kept here (was previously dropped when the
//   card ignored it).
// - `collapsible-file-tree`'s nested `CollapsibleContent` also carries a
//   `style-lyra:ml-4` class, a competing shadcn style-variant selector for a
//   base style we don't vendor — dropped, keeping the base `ml-5`.
// - `collapsible-file-tree`'s decorative header `Tabs` renders `TabsTrigger`s
//   with no matching `TabsContent`, so Radix's `aria-controls` points at a
//   panel id that doesn't exist (`aria-valid-attr-value`, a real a11y-gate
//   failure, not a false positive) — we add two empty `TabsContent`s to
//   satisfy the gate without changing the visible layout.
const meta = {
  component: Collapsible,
  subcomponents: {
    CollapsibleTrigger,
    CollapsibleContent,
  },
  parameters: {
    layout: "centered",
  },
  // Mirror the docs' ComponentPreview frame: center each example and
  // width-constrain it to a single width (same 22rem frame as select, since
  // Collapsible triggers/panels are compact controls, not full-page blocks),
  // so the verbatim per-example widths render uniformly here instead of each
  // story picking its own size.
  decorators: [
    (Story) => (
      <div className="w-[22rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof Collapsible>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use a controlled `open`/`onOpenChange` pair when a separate icon trigger
 * sits beside always-visible summary content, revealing extra detail
 * sections on demand; the play function verifies the toggle opens and
 * closes the panel.
 *
 * Adapted from [shadcn Collapsible demo](https://ui.shadcn.com/docs/components/base/collapsible)
 * (the default example at the top of the page, before any heading).
 *
 * @summary for a controlled disclosure beside always-visible summary content
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: function BasicRender() {
    const [isOpen, setIsOpen] = React.useState(false);

    return (
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="flex w-full flex-col gap-2"
      >
        <div className="flex items-center justify-between gap-4 px-4">
          <h4 className="text-sm font-semibold">Order #4189</h4>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <ChevronsUpDownIcon />
              <span className="sr-only">Toggle details</span>
            </Button>
          </CollapsibleTrigger>
        </div>
        <div className="flex items-center justify-between rounded-md border px-4 py-2 text-sm">
          <span className="text-muted-foreground">Status</span>
          <span className="font-medium">Shipped</span>
        </div>
        <CollapsibleContent className="flex flex-col gap-2">
          <div className="rounded-md border px-4 py-2 text-sm">
            <p className="font-medium">Shipping address</p>
            <p className="text-muted-foreground">
              100 Market St, San Francisco
            </p>
          </div>
          <div className="rounded-md border px-4 py-2 text-sm">
            <p className="font-medium">Items</p>
            <p className="text-muted-foreground">2x Studio Headphones</p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Toggle details" });

    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(
      canvas.queryByText("Shipping address"),
    ).not.toBeInTheDocument();

    await userEvent.click(trigger);
    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "true"),
    );
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText("Shipping address")).toBeVisible();

    await userEvent.click(trigger);
    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "false"),
    );
    await expect(
      canvas.queryByText("Shipping address"),
    ).not.toBeInTheDocument();
  },
};

/**
 * Use an `asChild` trigger button with the panel's own text and a rotating
 * chevron when the whole panel should highlight while open; the play
 * function verifies the panel and its action reveal on toggle.
 *
 * Adapted from [shadcn Collapsible › Basic](https://ui.shadcn.com/docs/components/base/collapsible#basic).
 *
 * @summary for a self-highlighting single panel inside a Card
 */
export const ProductDetails: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Card className="w-full">
      <CardContent>
        <Collapsible className="rounded-md data-open:bg-muted">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="group w-full">
              Product details
              <ChevronDownIcon className="ml-auto group-aria-expanded:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col items-start gap-2 p-2.5 pt-0 text-sm">
            <div>
              This panel can be expanded or collapsed to reveal additional
              content.
            </div>
            <Button size="xs">Learn More</Button>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Product details" });

    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(
      canvas.queryByText(/This panel can be expanded/),
    ).not.toBeInTheDocument();

    await userEvent.click(trigger);
    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "true"),
    );
    await expect(
      canvas.getByText(/This panel can be expanded or collapsed/),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Learn More" }),
    ).toBeVisible();
  },
};

type FileTreeItem = { name: string } | { name: string; items: FileTreeItem[] };

const fileTree: FileTreeItem[] = [
  {
    name: "components",
    items: [
      {
        name: "ui",
        items: [
          { name: "button.tsx" },
          { name: "card.tsx" },
          { name: "dialog.tsx" },
          { name: "input.tsx" },
          { name: "select.tsx" },
          { name: "table.tsx" },
        ],
      },
      { name: "login-form.tsx" },
      { name: "register-form.tsx" },
    ],
  },
  {
    name: "lib",
    items: [{ name: "utils.ts" }, { name: "cn.ts" }, { name: "api.ts" }],
  },
  {
    name: "hooks",
    items: [
      { name: "use-media-query.ts" },
      { name: "use-debounce.ts" },
      { name: "use-local-storage.ts" },
    ],
  },
  {
    name: "types",
    items: [{ name: "index.d.ts" }, { name: "api.d.ts" }],
  },
  {
    name: "public",
    items: [{ name: "favicon.ico" }, { name: "logo.svg" }, { name: "images" }],
  },
  { name: "app.tsx" },
  { name: "layout.tsx" },
  { name: "globals.css" },
  { name: "package.json" },
  { name: "tsconfig.json" },
  { name: "README.md" },
  { name: ".gitignore" },
];

function renderFileTreeItem(fileItem: FileTreeItem) {
  if ("items" in fileItem) {
    return (
      <Collapsible key={fileItem.name}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="group w-full justify-start transition-none hover:bg-accent hover:text-accent-foreground"
          >
            <ChevronRightIcon className="transition-transform group-aria-expanded:rotate-90" />
            <FolderIcon />
            {fileItem.name}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-1 ml-5">
          <div className="flex flex-col gap-1">
            {fileItem.items.map((child) => renderFileTreeItem(child))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }
  return (
    <Button
      key={fileItem.name}
      variant="link"
      size="sm"
      className="w-full justify-start gap-2 text-foreground"
    >
      <FileIcon />
      <span>{fileItem.name}</span>
    </Button>
  );
}

/**
 * Use nested collapsibles to build an expandable file tree, each folder an
 * independent disclosure; the play function verifies a folder reveals its
 * children, including a folder nested inside another.
 *
 * Adapted from [shadcn Collapsible › File Tree](https://ui.shadcn.com/docs/components/base/collapsible#file-tree).
 *
 * @summary for a nested, independently-collapsible file tree
 */
export const FileTree: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Card size="sm" className="w-full gap-2">
      <CardHeader>
        <Tabs defaultValue="explorer">
          <TabsList className="w-full">
            <TabsTrigger value="explorer">Explorer</TabsTrigger>
            <TabsTrigger value="settings">Outline</TabsTrigger>
          </TabsList>
          <TabsContent value="explorer" />
          <TabsContent value="settings" />
        </Tabs>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1">
          {fileTree.map((item) => renderFileTreeItem(item))}
        </div>
      </CardContent>
    </Card>
  ),
  play: async ({ canvas, userEvent }) => {
    const componentsTrigger = canvas.getByRole("button", {
      name: "components",
    });

    await expect(componentsTrigger).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByText("login-form.tsx")).not.toBeInTheDocument();

    await userEvent.click(componentsTrigger);
    await waitFor(() =>
      expect(componentsTrigger).toHaveAttribute("aria-expanded", "true"),
    );
    await expect(canvas.getByText("login-form.tsx")).toBeVisible();

    const uiTrigger = canvas.getByRole("button", { name: "ui" });
    await expect(canvas.queryByText("button.tsx")).not.toBeInTheDocument();

    await userEvent.click(uiTrigger);
    await waitFor(() =>
      expect(uiTrigger).toHaveAttribute("aria-expanded", "true"),
    );
    await expect(canvas.getByText("button.tsx")).toBeVisible();
  },
};

/**
 * Use a trigger button beside a `FieldGroup` to reveal additional fields
 * inline, keeping the common case compact; the play function verifies the
 * extra fields appear on toggle. Upstream's icon-only trigger has no
 * accessible name and its four fields reuse one `id` across two mismatched
 * `htmlFor`s — we add an `aria-label` and unique field ids/labels to satisfy
 * the a11y gate.
 *
 * Adapted from [shadcn Collapsible › Settings Panel](https://ui.shadcn.com/docs/components/base/collapsible#settings-panel).
 *
 * @summary for revealing additional form fields beside a compact default set
 */
export const Settings: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: function SettingsRender() {
    const [isOpen, setIsOpen] = React.useState(false);

    return (
      <Card size="sm" className="w-full">
        <CardHeader>
          <CardTitle>Radius</CardTitle>
          <CardDescription>
            Set the corner radius of the element.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Collapsible
            open={isOpen}
            onOpenChange={setIsOpen}
            className="flex items-start gap-2"
          >
            <FieldGroup className="grid w-full grid-cols-2 gap-2">
              <Field>
                <FieldLabel htmlFor="radius-x" className="sr-only">
                  Radius X
                </FieldLabel>
                <Input id="radius-x" placeholder="0" defaultValue={0} />
              </Field>
              <Field>
                <FieldLabel htmlFor="radius-y" className="sr-only">
                  Radius Y
                </FieldLabel>
                <Input id="radius-y" placeholder="0" defaultValue={0} />
              </Field>
              <CollapsibleContent className="col-span-full grid grid-cols-subgrid gap-2">
                <Field>
                  <FieldLabel htmlFor="radius-top-right" className="sr-only">
                    Top-right radius
                  </FieldLabel>
                  <Input
                    id="radius-top-right"
                    placeholder="0"
                    defaultValue={0}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="radius-bottom-left" className="sr-only">
                    Bottom-left radius
                  </FieldLabel>
                  <Input
                    id="radius-bottom-left"
                    placeholder="0"
                    defaultValue={0}
                  />
                </Field>
              </CollapsibleContent>
            </FieldGroup>
            <CollapsibleTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label="Toggle additional radius fields"
              >
                {isOpen ? <MinimizeIcon /> : <MaximizeIcon />}
              </Button>
            </CollapsibleTrigger>
          </Collapsible>
        </CardContent>
      </Card>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", {
      name: "Toggle additional radius fields",
    });

    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(
      canvas.queryByLabelText("Top-right radius"),
    ).not.toBeInTheDocument();

    await userEvent.click(trigger);
    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "true"),
    );
    await expect(canvas.getByLabelText("Top-right radius")).toBeVisible();
    await expect(canvas.getByLabelText("Bottom-left radius")).toBeVisible();
  },
};
