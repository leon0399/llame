import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen } from "storybook/test";

import { Button } from "./button.js";
import { ButtonGroup } from "./button-group.js";
import { Kbd, KbdGroup } from "./kbd.js";
import { contrastKnownIssue232 } from "./known-a11y-issues.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip.js";

// Every story here is transcribed from the shadcn Kbd docs examples
// (https://ui.shadcn.com/docs/components/base/kbd), so the file carries the
// "shadcn-example" provenance tag on each transcribed story. Kbd is a tiny atom, so
// no width decorator is used — `layout: "centered"` alone matches the docs'
// preview frame. `WithTooltip` (kbd-tooltip) is covered now that `ButtonGroup`
// is vendored. Skipped: kbd-input-group (built around `InputGroup`, a companion
// component we have not vendored). RTL is excluded by convention.
//
// KNOWN DEFECT (#232): Kbd's default recipe (`bg-muted` #f5f5f5 +
// `text-muted-foreground` #737373) fails WCAG AA color-contrast (4.34:1, needs
// 4.5:1), so `Basic` and `Group` render a real contrast failure. The fix is a
// change to the shared `--muted-foreground` token (app-wide blast radius), so
// pending that, those two stories spread `contrastKnownIssue232` to
// suppress ONLY the `color-contrast` rule (all other a11y rules still run) so
// CI isn't blocked — tracked in #232, removed when the token is fixed.
const meta = {
  component: Kbd,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Kbd>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use `Kbd` for a single key and `KbdGroup` to display a shortcut made of
 * several keys — either a row of modifier-key glyphs or a `+`-joined combo.
 *
 * Verbatim from the [shadcn Kbd demo](https://ui.shadcn.com/docs/components/base/kbd).
 *
 * @summary for the default single-key and multi-key shortcut display
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // #232: suppress color-contrast only — real muted-foreground defect, tracked.
  parameters: contrastKnownIssue232,
  render: () => (
    <div className="flex flex-col items-center gap-4">
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>⇧</Kbd>
        <Kbd>⌥</Kbd>
        <Kbd>⌃</Kbd>
      </KbdGroup>
      <KbdGroup>
        <Kbd>Ctrl</Kbd>
        <span>+</span>
        <Kbd>B</Kbd>
      </KbdGroup>
    </div>
  ),
};

/**
 * `KbdGroup` also groups whole `Kbd` keys (rather than individual key
 * glyphs) side by side, e.g. to list alternative shortcuts for the same
 * action inline with surrounding text.
 *
 * Verbatim from [shadcn Kbd › Group](https://ui.shadcn.com/docs/components/base/kbd#group).
 *
 * @summary for grouping alternative shortcuts inline with text
 */
export const Group: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // #232: suppress color-contrast only — real muted-foreground defect, tracked.
  parameters: contrastKnownIssue232,
  render: () => (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-muted-foreground">
        Use{" "}
        <KbdGroup>
          <Kbd>Ctrl + B</Kbd>
          <Kbd>Ctrl + K</Kbd>
        </KbdGroup>{" "}
        to open the command palette
      </p>
    </div>
  ),
};

/**
 * Nest `Kbd` inside a `Button` label to show the shortcut that also
 * triggers it, such as an Enter-to-submit affordance.
 *
 * Verbatim from [shadcn Kbd › Button](https://ui.shadcn.com/docs/components/base/kbd#button).
 *
 * @summary for a button whose label also shows its shortcut key
 */
export const InButton: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Button variant="outline">
      Accept{" "}
      <Kbd data-icon="inline-end" className="translate-x-0.5">
        ⏎
      </Kbd>
    </Button>
  ),
};

/**
 * Put a `Kbd`/`KbdGroup` inside a `TooltipContent` so an action's shortcut
 * shows on hover — here two `ButtonGroup`-attached buttons, each with its
 * shortcut in the tooltip. The play function hovers the first button and
 * verifies its tooltip (with the key hint) appears.
 *
 * Verbatim from [shadcn Kbd › Tooltip](https://ui.shadcn.com/docs/components/base/kbd#tooltip).
 *
 * @summary for surfacing a shortcut in a button's hover tooltip
 */
export const WithTooltip: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <TooltipProvider>
      <div className="flex flex-wrap gap-4">
        <ButtonGroup>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Save</Button>
            </TooltipTrigger>
            <TooltipContent>
              Save Changes <Kbd>S</Kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Print</Button>
            </TooltipTrigger>
            <TooltipContent>
              Print Document{" "}
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>P</Kbd>
              </KbdGroup>
            </TooltipContent>
          </Tooltip>
        </ButtonGroup>
      </div>
    </TooltipProvider>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByRole("button", { name: "Save" }));
    // Radix renders the content twice (visible + an sr-only role="tooltip"
    // mirror), and it portals to document.body — assert the unique tooltip role.
    const tip = await screen.findByRole("tooltip");
    await expect(tip).toHaveTextContent("Save Changes");
  },
};
