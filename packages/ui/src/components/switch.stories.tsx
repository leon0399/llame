import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { Label } from "./label.js";
import { Switch } from "./switch.js";

const meta = {
  component: Switch,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    defaultChecked: {
      control: "boolean",
      description: "Whether the switch is checked by default",
    },
    checked: {
      control: "boolean",
      description: "Whether the switch is checked",
    },
    onCheckedChange: {
      control: false,
      description: "Callback fired when the checked state changes",
      type: { name: "function", required: false },
    },
    disabled: {
      control: "boolean",
      description: "Whether the switch is disabled",
    },
  },
} satisfies Meta<typeof Switch>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
  render: (args) => (
    <div className="flex items-center gap-2">
      <Switch id="airplane-mode" {...args} />
      <Label htmlFor="airplane-mode">Airplane Mode</Label>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const switchElement = canvas.getByRole("switch");
    const label = canvas.getByText("Airplane Mode");

    await expect(switchElement).toBeInTheDocument();
    await expect(label).toBeInTheDocument();
    await expect(switchElement).not.toBeChecked();

    await userEvent.click(switchElement);
    await expect(switchElement).toBeChecked();

    await userEvent.click(label);
    await expect(switchElement).not.toBeChecked();
  },
};

export const Basic: Story = {
  args: {
    "aria-label": "Basic switch",
  },
  play: async ({ canvas, userEvent }) => {
    const switchElement = canvas.getByRole("switch");

    await expect(switchElement).not.toBeChecked();
    await userEvent.click(switchElement);
    await expect(switchElement).toBeChecked();
  },
};

export const DefaultChecked: Story = {
  args: {
    "aria-label": "Default checked switch",
    defaultChecked: true,
  },
  play: async ({ canvas, userEvent }) => {
    const switchElement = canvas.getByRole("switch");

    await expect(switchElement).toBeChecked();
    await userEvent.click(switchElement);
    await expect(switchElement).not.toBeChecked();
    await userEvent.click(switchElement);
    await expect(switchElement).toBeChecked();
  },
};

export const Disabled: Story = {
  args: {
    "aria-label": "Disabled switch",
    disabled: true,
  },
  play: async ({ canvas, userEvent }) => {
    const switchElement = canvas.getByRole("switch");

    await expect(switchElement).not.toBeChecked();
    await userEvent.click(switchElement);
    await expect(switchElement).not.toBeChecked();
  },
};

export const DisabledChecked: Story = {
  args: {
    "aria-label": "Disabled checked switch",
    checked: true,
    disabled: true,
  },
  play: async ({ canvas, userEvent }) => {
    const switchElement = canvas.getByRole("switch");

    await expect(switchElement).toBeChecked();
    await userEvent.click(switchElement);
    await expect(switchElement).toBeChecked();
  },
};
