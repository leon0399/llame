import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { Label } from "./label.js";
import { Switch } from "./switch.js";

const meta = {
  component: Switch,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs", "ai-generated"],
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

/**
 * Pair with a Label via `htmlFor` so the label text toggles the switch too —
 * the play function verifies both click targets.
 *
 * @summary for the standard labelled form switch
 */
export const WithLabel: Story = {
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

/**
 * Use a bare switch only when the surrounding context labels it; an
 * `aria-label` is required without a visible Label.
 *
 * @summary for a bare switch with aria-label only
 */
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

/**
 * Use `defaultChecked` for uncontrolled switches that start on; the play
 * function verifies it still toggles freely.
 *
 * @summary for uncontrolled initially-on state
 */
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

/**
 * Use `disabled` for a temporarily unavailable setting; the play function
 * verifies clicks do not change state.
 *
 * @summary for non-interactive off state
 */
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

/**
 * Use `disabled` + `checked` for a locked-on setting (e.g. enforced by
 * policy); the play function verifies it cannot be turned off.
 *
 * @summary for locked-on state
 */
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
