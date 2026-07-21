import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, waitFor } from "storybook/test";

import { Button } from "./button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog.js";
import { Field, FieldGroup, FieldLabel } from "./field.js";
import { Input } from "./input.js";
import { Label } from "./label.js";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./popover.js";

// Every story in this file except `InDialog` is `shadcn-example` (the meta
// default below), transcribed from the shadcn Popover docs examples
// (https://ui.shadcn.com/docs/components/base/popover): `Basic` from the
// default demo at the top of the page (`popover-demo`), `WithHeader` from
// the "Basic" section (`popover-basic`), `Alignments` from "Align"
// (`popover-alignments`), and `WithForm` from "With Form" (`popover-form`)
// — all sourced from `apps/v4/examples/radix/` (the source the docs'
// "Radix UI" tab renders). Every one of these examples composes only the
// standard `<Popover>`/`<PopoverContent align>`/`PopoverHeader`/
// `PopoverTitle`/`PopoverDescription` public API, which our `popover.tsx`
// fully supports — a prior sweep under-adopted `WithForm` and `Alignments`
// as `ai-generated` on a mistaken belief that `radix-nova`-only preview
// availability made them incompatible (see packages/ui/AGENTS.md's
// "Compatibility is about USAGE" note). `InDialog` (its tag overrides the
// meta default) is our own composition test with no upstream doc coverage.
// Upstream example we intentionally skip: RTL (excluded by convention, and
// nova-only regardless).
const meta = {
  component: Popover,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Popover>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use for a click-triggered popup holding a small inline form; the play
 * function verifies the trigger toggles it open/closed and the field
 * defaults.
 *
 * Verbatim from [shadcn Popover](https://ui.shadcn.com/docs/components/base/popover)
 * (the default example at the top of the page).
 *
 * @summary for the standard click-triggered form popover
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Open popover</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="grid gap-4">
          <div className="space-y-2">
            <h4 className="leading-none font-medium">Dimensions</h4>
            <p className="text-sm text-muted-foreground">
              Set the dimensions for the layer.
            </p>
          </div>
          <div className="grid gap-2">
            <div className="grid grid-cols-3 items-center gap-4">
              <Label htmlFor="width">Width</Label>
              <Input
                id="width"
                defaultValue="100%"
                className="col-span-2 h-8"
              />
            </div>
            <div className="grid grid-cols-3 items-center gap-4">
              <Label htmlFor="maxWidth">Max. width</Label>
              <Input
                id="maxWidth"
                defaultValue="300px"
                className="col-span-2 h-8"
              />
            </div>
            <div className="grid grid-cols-3 items-center gap-4">
              <Label htmlFor="height">Height</Label>
              <Input
                id="height"
                defaultValue="25px"
                className="col-span-2 h-8"
              />
            </div>
            <div className="grid grid-cols-3 items-center gap-4">
              <Label htmlFor="maxHeight">Max. height</Label>
              <Input
                id="maxHeight"
                defaultValue="none"
                className="col-span-2 h-8"
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Open popover" });

    await userEvent.click(trigger);
    await expect(await screen.findByText("Dimensions")).toBeInTheDocument();
    await expect(screen.getByLabelText("Width")).toHaveValue("100%");
    await expect(screen.getByLabelText("Max. width")).toHaveValue("300px");
    await expect(screen.getByLabelText("Height")).toHaveValue("25px");
    await expect(screen.getByLabelText("Max. height")).toHaveValue("none");

    await userEvent.click(trigger);
    await waitFor(() =>
      expect(screen.queryByText("Dimensions")).not.toBeInTheDocument(),
    );
  },
};

/**
 * Use PopoverHeader/PopoverTitle/PopoverDescription alone when the popover's
 * content is just a labelled heading with no additional body; the play
 * function verifies the title/description render and the alignment
 * attribute.
 *
 * Verbatim from [shadcn Popover › Basic](https://ui.shadcn.com/docs/components/base/popover#basic).
 *
 * @summary for a minimal header-only popover
 */
export const WithHeader: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Open Popover</Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>Dimensions</PopoverTitle>
          <PopoverDescription>
            Set the dimensions for the layer.
          </PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Open Popover" });

    await userEvent.click(trigger);
    const title = await screen.findByText("Dimensions");
    await expect(
      screen.getByText("Set the dimensions for the layer."),
    ).toBeInTheDocument();
    await expect(
      title.closest("[data-slot='popover-content']"),
    ).toHaveAttribute("data-align", "start");

    await userEvent.click(trigger);
    await waitFor(() =>
      expect(screen.queryByText("Dimensions")).not.toBeInTheDocument(),
    );
  },
};

/**
 * Use `align` to control which trigger edge the content lines up with; the
 * play function verifies each alignment attribute.
 *
 * Verbatim from [shadcn Popover › Align](https://ui.shadcn.com/docs/components/base/popover#align).
 *
 * @summary for choosing content alignment
 */
export const Alignments: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <div className="flex gap-6">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            Start
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-40">
          Aligned to start
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            Center
          </Button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-40">
          Aligned to center
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            End
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-40">
          Aligned to end
        </PopoverContent>
      </Popover>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    for (const [triggerName, contentText, alignment] of [
      ["Start", "Aligned to start", "start"],
      ["Center", "Aligned to center", "center"],
      ["End", "Aligned to end", "end"],
    ] as const) {
      await userEvent.click(canvas.getByRole("button", { name: triggerName }));
      const content = await screen.findByText(contentText);
      await expect(
        content.closest("[data-slot='popover-content']"),
      ).toHaveAttribute("data-align", alignment);
      await userEvent.click(canvas.getByRole("button", { name: triggerName }));
      await waitFor(() =>
        expect(screen.queryByText(contentText)).not.toBeInTheDocument(),
      );
    }
  },
};

/**
 * Use our `Field`/`FieldGroup` composition for small inline editing tasks
 * that don't warrant a full Dialog; fields are labelled via `FieldLabel`
 * `htmlFor`. The play function verifies the trigger opens the form and the
 * field defaults.
 *
 * Verbatim from [shadcn Popover › With Form](https://ui.shadcn.com/docs/components/base/popover#with-form).
 *
 * @summary for inline mini-forms using Field components
 */
export const WithForm: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Open Popover</Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <PopoverHeader>
          <PopoverTitle>Dimensions</PopoverTitle>
          <PopoverDescription>
            Set the dimensions for the layer.
          </PopoverDescription>
        </PopoverHeader>
        <FieldGroup className="gap-4">
          <Field orientation="horizontal">
            <FieldLabel htmlFor="width" className="w-1/2">
              Width
            </FieldLabel>
            <Input id="width" defaultValue="100%" />
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="height" className="w-1/2">
              Height
            </FieldLabel>
            <Input id="height" defaultValue="25px" />
          </Field>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Open Popover" });

    await userEvent.click(trigger);
    await expect(await screen.findByLabelText("Width")).toHaveValue("100%");
    await expect(screen.getByLabelText("Height")).toHaveValue("25px");

    await userEvent.click(trigger);
    await waitFor(() =>
      expect(screen.queryByLabelText("Width")).not.toBeInTheDocument(),
    );
  },
};

/**
 * Use to verify popovers layer correctly above an open Dialog without focus
 * conflicts. Upstream's docs page doesn't document a nested-in-Dialog case,
 * so this is our own composition test.
 *
 * @summary for nesting inside a Dialog
 */
export const InDialog: Story = {
  tags: ["ai-generated"],
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Open Dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Popover Example</DialogTitle>
          <DialogDescription>
            Click the button below to see the popover.
          </DialogDescription>
        </DialogHeader>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-fit">
              Open Popover
            </Button>
          </PopoverTrigger>
          <PopoverContent aria-label="Popover in Dialog" align="start">
            <PopoverHeader>
              <PopoverTitle>Popover in Dialog</PopoverTitle>
              <PopoverDescription>
                This popover appears inside a dialog. Click the button to open
                it.
              </PopoverDescription>
            </PopoverHeader>
          </PopoverContent>
        </Popover>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Open Dialog" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Popover Example",
    });
    await expect(dialog).toHaveAccessibleDescription(
      "Click the button below to see the popover.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Open Popover" }));
    await expect(
      await screen.findByText("Popover in Dialog"),
    ).toBeInTheDocument();
    await expect(
      screen.getByText(
        "This popover appears inside a dialog. Click the button to open it.",
      ),
    ).toBeInTheDocument();
  },
};
