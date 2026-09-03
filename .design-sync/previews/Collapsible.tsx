import * as React from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  FileIcon,
  FolderIcon,
  MaximizeIcon,
  MinimizeIcon,
} from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";

// Every story below has a play function that opens the panel AFTER the
// initial (closed) render (the interaction-driven-content limitation
// documented in .ds-sync/storybook/SKILL.md §4a — compiled previews never
// run play). The storybook reference screenshot is captured POST-play, so
// each story mirrors the story's JSX verbatim but forces the post-play open
// state via the real `defaultOpen`/initial-state prop instead of the
// story's own pre-interaction default.

const frame = "w-[22rem] max-w-full";

export const Basic = () => {
  // play toggles the trigger TWICE — open, assert, then closed again — so the
  // reference ends collapsed and this mirrors the story's own useState(false).
  // (Settings below looks identical but clicks only once, so it does end open.)
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <div className={frame}>
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="flex w-full flex-col gap-2"
      >
        <div className="flex items-center justify-between gap-4 px-4">
          <h4 className="text-sm font-semibold">Order #4189</h4>
          <CollapsibleTrigger
            render={<Button variant="ghost" size="icon" className="size-8" />}
          >
            <ChevronsUpDownIcon />
            <span className="sr-only">Toggle details</span>
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
    </div>
  );
};

export const ProductDetails = () => (
  <div className={frame}>
    {/* play clicks the trigger — ends open */}
    <Card className="w-full">
      <CardContent>
        <Collapsible defaultOpen className="rounded-md data-open:bg-muted">
          <CollapsibleTrigger
            render={<Button variant="ghost" className="group w-full" />}
          >
            Product details
            <ChevronDownIcon className="ml-auto group-aria-expanded:rotate-180" />
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
  </div>
);

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

// play opens "components", then its nested "ui" folder — both end open;
// every other folder is untouched and stays at its (closed) default.
const openByDefault = new Set(["components", "ui"]);

function renderFileTreeItem(fileItem: FileTreeItem) {
  if ("items" in fileItem) {
    return (
      <Collapsible
        key={fileItem.name}
        defaultOpen={openByDefault.has(fileItem.name)}
      >
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="group w-full justify-start transition-none hover:bg-accent hover:text-accent-foreground"
            />
          }
        >
          <ChevronRightIcon className="transition-transform group-aria-expanded:rotate-90" />
          <FolderIcon />
          {fileItem.name}
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

export const FileTree = () => (
  <div className={frame}>
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
  </div>
);

export const Settings = () => {
  // play toggles the trigger once — ends open (was: useState(false))
  const [isOpen, setIsOpen] = React.useState(true);

  return (
    <div className={frame}>
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
            <CollapsibleTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Toggle additional radius fields"
                />
              }
            >
              {isOpen ? <MinimizeIcon /> : <MaximizeIcon />}
            </CollapsibleTrigger>
          </Collapsible>
        </CardContent>
      </Card>
    </div>
  );
};
