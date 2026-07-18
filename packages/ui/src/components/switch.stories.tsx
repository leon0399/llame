import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { Label } from "./label.js";
import { Switch } from "./switch.js";

// `Basic` is transcribed verbatim from the shadcn Switch docs demo
// (https://ui.shadcn.com/docs/components/radix/switch), so the file carries
// the "shadcn-example" provenance tag at the meta level. The live docs page
// also lists Description, Choice Card, Disabled, Invalid, Size, and RTL
// sections, but as of this writing those preview shadcn's newer "radix" base
// + "nova" style registry (`apps/v4/registry/bases/radix`) rather than the
// `new-york-v4` style our `components.json` targets — that Switch
// implementation has diverged from ours (`cn-switch`/`cn-switch-thumb`
// stylesheet classes, `data-disabled` instead of Tailwind `disabled:`), and
// "Choice Card" and "Invalid" have no corresponding example file in the
// upstream repo at all (broken/WIP doc references). We skip all of them (RTL
// is excluded by convention regardless — see skip log in the team report) and
// instead keep our own additional states — `WithAriaLabel`, `DefaultChecked`,
// `Disabled`, `DisabledChecked`, `Sizes` — tagged "ai-generated".
const meta = {
  component: Switch,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs", "shadcn-example"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "default"],
      description: "Visual size of the switch and its thumb.",
    },
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
 * The standard way to pair a switch with a visible label — `Label`'s
 * `htmlFor` means clicking the label text also toggles the switch.
 *
 * Verbatim from [shadcn Switch demo](https://ui.shadcn.com/docs/components/radix/switch).
 *
 * @summary for the default labelled form switch
 */
export const Basic: Story = {
  args: {},
  render: (args) => (
    <div className="flex items-center space-x-2">
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
export const WithAriaLabel: Story = {
  tags: ["ai-generated", "!shadcn-example"],
  args: {
    "aria-label": "Bare switch",
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
  tags: ["ai-generated", "!shadcn-example"],
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
  tags: ["ai-generated", "!shadcn-example"],
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
  tags: ["ai-generated", "!shadcn-example"],
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

/**
 * Use the `size` prop to fit the switch to denser layouts (`sm`) or the
 * standard form density (`default`).
 *
 * @summary reference of the switch size scale
 */
export const Sizes: Story = {
  tags: ["ai-generated", "!shadcn-example"],
  args: {},
  // `size` is fixed per switch in this showcase, so its control would be
  // inert here — disable it (the row stays visible, just not editable).
  argTypes: {
    size: { control: false },
  },
  render: (args) => (
    <div className="flex items-center gap-6">
      <Switch {...args} size="sm" aria-label="Small switch" />
      <Switch {...args} size="default" aria-label="Default switch" />
    </div>
  ),
  play: async ({ canvas }) => {
    const switches = canvas.getAllByRole("switch");

    await expect(switches).toHaveLength(2);
    await expect(switches[0]).toHaveAttribute("data-size", "sm");
    await expect(switches[1]).toHaveAttribute("data-size", "default");
  },
};
