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
        rules: [{ id: "aria-hidden-focus", enabled: false }],
      },
    },
  },
  tags: ["autodocs"],
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

export const Default: Story = {
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
