import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, waitFor, within } from "storybook/test";

import { Button } from "./button.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";

// This file is mixed provenance: `shadcn-example` (the meta default below)
// for stories transcribed from the shadcn Dropdown Menu docs
// (https://ui.shadcn.com/docs/components/radix/dropdown-menu); each such
// story overrides nothing and links its docs anchor. `ai-generated` stories
// (each overrides the tag itself) cover our own compositions with no
// compatible upstream source.
//
// Upstream is mid-migration: its docs page now previews every example
// (including the ones covered below) through the incompatible `radix-nova`
// registry, but three of the underlying example files still exist,
// unchanged, in the coherent `new-york-v4` registry our `components.json`
// targets — `dropdown-menu-demo`, `dropdown-menu-checkboxes`, and
// `dropdown-menu-radio-group` — which back `Basic`, `Checkboxes`, and
// `RadioGroup` below. Everything else in the docs' example list (Icons,
// Checkboxes Icons, Radio Icons, Destructive, Avatar, Complex) only exists
// as a `radix-nova`/`bases/radix` source and is skipped per convention.
// Submenu and Shortcuts are *not* gaps despite also being nova-only sources:
// the demo (`Basic`) already renders both inline. `Destructive` has no
// compatible upstream source to transcribe, but `variant="destructive"` is a
// real prop our component supports with no other coverage, so we keep an
// `ai-generated` story for it instead of leaving the prop undocumented. RTL
// is skipped by convention regardless.
//
// Note: our `DropdownMenuRadioItem` is an intentional fork (see its comment
// in dropdown-menu.tsx) — selection is marked with a trailing CheckIcon on
// the right, not upstream's leading dot. `RadioGroup` below is still
// `shadcn-example` (the composition is verbatim), but its rendered selection
// indicator differs from what upstream's own screenshot shows.
const meta = {
  component: DropdownMenu,
  subcomponents: {
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuPortal,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
  },
  parameters: {
    layout: "centered",
    a11y: {
      config: {
        // Radix portals DropdownMenuContent outside the trigger's DOM
        // subtree and toggles `aria-hidden` on the rest of the page while
        // open. axe's aria-hidden-focus rule then flags the still-mounted
        // (but visually hidden) trigger/canvas root as a focusable element
        // inside an aria-hidden container — a false positive specific to
        // the portal + jsdom test environment, not a real browser issue.
        rules: [{ id: "aria-hidden-focus", enabled: false }],
      },
    },
  },
  tags: ["autodocs", "shadcn-example"],
  argTypes: {},
} satisfies Meta<typeof DropdownMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

function CheckboxMenu(props: React.ComponentProps<typeof DropdownMenu>) {
  const [showStatusBar, setShowStatusBar] = React.useState(true);
  const [showActivityBar, setShowActivityBar] = React.useState(false);
  const [showPanel, setShowPanel] = React.useState(false);

  return (
    <DropdownMenu {...props}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Open</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={showStatusBar}
          onCheckedChange={setShowStatusBar}
        >
          Status Bar
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={showActivityBar}
          disabled
          onCheckedChange={setShowActivityBar}
        >
          Activity Bar
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={showPanel}
          onCheckedChange={setShowPanel}
        >
          Panel
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RadioGroupMenu(props: React.ComponentProps<typeof DropdownMenu>) {
  const [position, setPosition] = React.useState("bottom");

  return (
    <DropdownMenu {...props}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Open</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Panel Position</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup onValueChange={setPosition} value={position}>
          <DropdownMenuRadioItem value="top">Top</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="bottom">Bottom</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="right">Right</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Use for command menus organized into groups with shortcuts and nested
 * submenus; the play function verifies the submenu opens.
 *
 * Verbatim from [shadcn Dropdown Menu demo](https://ui.shadcn.com/docs/components/radix/dropdown-menu)
 * (the default example at the top of the page — it already covers the
 * Submenu and Shortcuts sections listed further down that page).
 *
 * @summary for the standard command menu with submenu
 */
export const Basic: Story = {
  args: {},
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Open</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem>
            Profile <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            Billing <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            Settings <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            Keyboard shortcuts <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>Team</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Invite users</DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Email</DropdownMenuItem>
                <DropdownMenuItem>Message</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>More...</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuItem>
            New Team <DropdownMenuShortcut>⌘+T</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem>GitHub</DropdownMenuItem>
        <DropdownMenuItem>Support</DropdownMenuItem>
        <DropdownMenuItem disabled>API</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          Log out <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvas, userEvent }) => {
    const triggerButton = canvas.getByText("Open");
    await expect(triggerButton).toBeInTheDocument();

    await userEvent.click(triggerButton);
    const dropdown = screen.getByRole("menu");
    await expect(dropdown).toBeInTheDocument();

    const inviteUsersItem = within(dropdown).getByText("Invite users");
    await expect(inviteUsersItem).toBeInTheDocument();
    await userEvent.click(inviteUsersItem);

    const emailItem = await screen.findByText("Email");
    await expect(emailItem).toBeInTheDocument();
    await waitFor(() => expect(emailItem).toBeVisible());
  },
};

/**
 * Use DropdownMenuCheckboxItem for independent toggles whose state persists
 * across menu open/close; the play function verifying the round-trip is our
 * own overlay on top of the upstream example.
 *
 * Verbatim from [shadcn Dropdown Menu › Checkboxes](https://ui.shadcn.com/docs/components/radix/dropdown-menu#checkboxes).
 *
 * @summary for independent toggle items
 */
export const Checkboxes: Story = {
  args: {},
  render: (args) => <CheckboxMenu {...args} />,
  play: async ({ canvas, userEvent }) => {
    const triggerButton = canvas.getByText("Open");
    await userEvent.click(triggerButton);

    const dropdown = screen.getByRole("menu");
    const statusBarItem = within(dropdown).getByRole("menuitemcheckbox", {
      name: "Status Bar",
    });
    const activityBarItem = within(dropdown).getByRole("menuitemcheckbox", {
      name: "Activity Bar",
    });
    await expect(activityBarItem).toBeInTheDocument();
    await expect(activityBarItem).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(statusBarItem);
    await expect(statusBarItem).not.toBeChecked();

    await userEvent.click(triggerButton);
    const reopenedDropdown = screen.getByRole("menu");
    const reopenedPanelItem = within(reopenedDropdown).getByRole(
      "menuitemcheckbox",
      { name: "Panel" },
    );
    await userEvent.click(reopenedPanelItem);
    await expect(reopenedPanelItem).toBeChecked();
  },
};

/**
 * Use DropdownMenuRadioGroup for a mutually-exclusive choice; the play
 * function verifies selecting one option clears the others. The composition
 * is verbatim upstream, but our selection indicator is a trailing CheckIcon
 * (an intentional fork — see `DropdownMenuRadioItem` in dropdown-menu.tsx),
 * not the leading dot upstream's own screenshot shows.
 *
 * Verbatim from [shadcn Dropdown Menu › Radio Group](https://ui.shadcn.com/docs/components/radix/dropdown-menu#radio-group).
 *
 * @summary for mutually-exclusive selection
 */
export const RadioGroup: Story = {
  args: {},
  render: (args) => <RadioGroupMenu {...args} />,
  play: async ({ canvas, userEvent }) => {
    const triggerButton = canvas.getByText("Open");
    await userEvent.click(triggerButton);

    const dropdown = screen.getByRole("menu");
    const topItem = within(dropdown).getByRole("menuitemradio", {
      name: "Top",
    });
    const bottomItem = within(dropdown).getByRole("menuitemradio", {
      name: "Bottom",
    });
    const rightItem = within(dropdown).getByRole("menuitemradio", {
      name: "Right",
    });

    await userEvent.click(topItem);
    await expect(topItem).toBeChecked();
    await expect(bottomItem).not.toBeChecked();
    await expect(rightItem).not.toBeChecked();

    await userEvent.click(triggerButton);
    const reopenedDropdown = screen.getByRole("menu");
    const reopenedTopItem = within(reopenedDropdown).getByRole(
      "menuitemradio",
      {
        name: "Top",
      },
    );
    const reopenedBottomItem = within(reopenedDropdown).getByRole(
      "menuitemradio",
      { name: "Bottom" },
    );
    const reopenedRightItem = within(reopenedDropdown).getByRole(
      "menuitemradio",
      {
        name: "Right",
      },
    );
    await userEvent.click(reopenedRightItem);
    await expect(reopenedRightItem).toBeChecked();
    await expect(reopenedTopItem).not.toBeChecked();
    await expect(reopenedBottomItem).not.toBeChecked();
  },
};

/**
 * Use `variant="destructive"` on a DropdownMenuItem for an irreversible or
 * dangerous action, such as deleting a resource. Upstream only documents
 * this under its migrated `radix-nova` registry with no compatible source
 * to transcribe, so this story is authored directly against our component
 * to keep the prop covered.
 *
 * @summary for a dangerous or irreversible action within a menu
 */
export const Destructive: Story = {
  tags: ["ai-generated", "!shadcn-example"],
  args: {},
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Open</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start">
        <DropdownMenuItem>Rename</DropdownMenuItem>
        <DropdownMenuItem>Duplicate</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          Delete <DropdownMenuShortcut>⌘⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvas, userEvent }) => {
    const triggerButton = canvas.getByText("Open");
    await userEvent.click(triggerButton);

    const dropdown = screen.getByRole("menu");
    const deleteItem = within(dropdown).getByRole("menuitem", {
      name: /delete/i,
    });
    await expect(deleteItem).toBeInTheDocument();
    await expect(deleteItem).toHaveAttribute("data-variant", "destructive");
  },
};
