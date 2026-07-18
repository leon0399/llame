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
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./popover.js";

const meta = {
  component: Popover,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs", "ai-generated"],
} satisfies Meta<typeof Popover>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use for lightweight click-triggered surfaces with a heading; the play
 * function verifies the trigger toggles it open and closed.
 *
 * @summary for the standard click-triggered popover
 */
export const Basic: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Open Popover</Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Dimensions" align="start">
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
    await expect(title).toBeInTheDocument();
    await expect(
      screen.getByText("Set the dimensions for the layer."),
    ).toBeInTheDocument();

    await userEvent.click(trigger);
    await waitFor(() =>
      expect(screen.queryByText("Dimensions")).not.toBeInTheDocument(),
    );
  },
};

/**
 * Use for small inline editing tasks that don't warrant a full Dialog;
 * fields are labelled via FieldLabel `htmlFor`.
 *
 * @summary for inline mini-forms
 */
export const WithForm: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Open Popover</Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Dimensions" className="w-64" align="start">
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
    await userEvent.click(canvas.getByRole("button", { name: "Open Popover" }));

    await expect(await screen.findByLabelText("Width")).toHaveValue("100%");
    await expect(screen.getByLabelText("Height")).toHaveValue("25px");
    await expect(screen.queryByLabelText("Max. width")).not.toBeInTheDocument();
  },
};

/**
 * Use `align` to control which trigger edge the content lines up with; the
 * play function verifies each alignment attribute.
 *
 * @summary for choosing content alignment
 */
export const Alignments: Story = {
  render: () => (
    <div className="flex gap-6">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            Start
          </Button>
        </PopoverTrigger>
        <PopoverContent
          aria-label="Aligned to start"
          align="start"
          className="w-40"
        >
          Aligned to start
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            Center
          </Button>
        </PopoverTrigger>
        <PopoverContent
          aria-label="Aligned to center"
          align="center"
          className="w-40"
        >
          Aligned to center
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            End
          </Button>
        </PopoverTrigger>
        <PopoverContent
          aria-label="Aligned to end"
          align="end"
          className="w-40"
        >
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
 * Use to verify popovers layer correctly above an open Dialog without focus
 * conflicts.
 *
 * @summary for nesting inside a Dialog
 */
export const InDialog: Story = {
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
