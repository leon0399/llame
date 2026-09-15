import { ArrowUpRightIcon, BadgeCheckIcon, BookmarkIcon } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { Badge } from "./badge.js";
import { contrastKnownIssue232 } from "./known-a11y-issues.js";
import { Spinner } from "./spinner.js";

// Every story here is transcribed from the shadcn Badge docs examples
// (https://ui.shadcn.com/docs/components/base/badge), so the file carries
// the "shadcn-example" provenance tag on each transcribed story. Adaptations are
// limited to import paths and our lucide `...Icon` naming convention; each
// story links its docs anchor. The one exception is `Colors`: it keeps the
// example's subject — a category set layered on through `className` — but not
// its raw-palette values, which DESIGN.md §2 forbids, so it demonstrates the
// achromatic value scale instead.
//
// Unlike button/switch, our badgeVariants scale
// (default/secondary/destructive/outline/ghost/link) is a full match for the
// docs' current `variant` API table, so no example is skipped for a
// component/prop gap — the only exclusion is RTL, by convention. The example
// directory also holds avatar-badge(-icon), input-badge, sidebar-menu-badge,
// and spinner-badge, but those illustrate *other* components' docs pages
// (Avatar, Input, Sidebar) per badge.mdx's own example list, not Badge's —
// they're out of scope here, not skipped for incompatibility.
const meta = {
  component: Badge,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "secondary",
        "destructive",
        "outline",
        "ghost",
        "link",
      ],
      description: "Visual emphasis / semantic style of the badge.",
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The four default badge variants together, matching the docs' lead preview.
 *
 * Verbatim from the [shadcn Badge demo](https://ui.shadcn.com/docs/components/base/badge).
 *
 * @summary for the default variant set at a glance
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // #232 — base-nova's subtle destructive (bg-destructive/10) fails color-contrast.
  parameters: contrastKnownIssue232,
  render: () => (
    <div className="flex w-full flex-wrap justify-center gap-2">
      <Badge>Badge</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  ),
};

/**
 * The full variant scale in one place — `default`, `secondary`,
 * `destructive`, `outline`, and `ghost` — for picking the right emphasis at a
 * glance. Our badge also supports `link`; see the `variant` control.
 *
 * Verbatim from [shadcn Badge › Variants](https://ui.shadcn.com/docs/components/base/badge#variants).
 *
 * @summary reference of the badge variant scale
 */
export const Variants: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // #232 — base-nova's subtle destructive (bg-destructive/10) fails color-contrast.
  parameters: contrastKnownIssue232,
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="ghost">Ghost</Badge>
    </div>
  ),
};

/**
 * A badge can carry a leading or trailing icon via `data-icon="inline-start"`
 * / `data-icon="inline-end"` on the icon element, for a status badge that
 * needs a glyph alongside its label.
 *
 * Adapted from [shadcn Badge › With Icon](https://ui.shadcn.com/docs/components/base/badge#with-icon)
 * for our lucide `...Icon` naming convention (`BadgeCheckIcon`).
 *
 * @summary for a badge with a leading or trailing icon
 */
export const WithIcon: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="secondary">
        <BadgeCheckIcon data-icon="inline-start" />
        Verified
      </Badge>
      <Badge variant="outline">
        Bookmark
        <BookmarkIcon data-icon="inline-end" />
      </Badge>
    </div>
  ),
};

/**
 * A badge can host a `Spinner` in place of its label icon to show an
 * in-progress state, such as a background delete or an in-flight generation.
 *
 * Verbatim from [shadcn Badge › With Spinner](https://ui.shadcn.com/docs/components/base/badge#with-spinner).
 *
 * @summary for a badge showing an in-progress state
 */
export const WithSpinner: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // #232 — base-nova's subtle destructive (bg-destructive/10) fails color-contrast.
  // Contains a continuously-spinning Spinner, so a screenshot captures a
  // nondeterministic frame; skip screenshot capture (render still runs).
  parameters: { ...contrastKnownIssue232, visualTests: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="destructive">
        <Spinner data-icon="inline-start" />
        Deleting
      </Badge>
      <Badge variant="secondary">
        Generating
        <Spinner data-icon="inline-end" />
      </Badge>
    </div>
  ),
};

/**
 * `render={<a/>}` renders the badge styling onto a link, so it can look and
 * behave like a badge — e.g. a clickable reference chip.
 *
 * Adapted from [shadcn Badge › Link](https://ui.shadcn.com/docs/components/base/badge#link),
 * to a plain `<a>` (upstream uses `next/link`).
 *
 * @summary for styling a link as a badge via `render`
 */
export const AsLink: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Badge render={<a href="#link" />}>
      Open Link <ArrowUpRightIcon data-icon="inline-end" />
    </Badge>
  ),
  play: async ({ canvas }) => {
    const link = canvas.getByRole("link", { name: "Open Link" });

    await expect(link).toBeInTheDocument();
    await expect(link).toHaveAttribute("href", "#link");
  },
};

/**
 * Badge accepts `className` overrides, so a category set can be layered on for
 * domain-specific categorization without a new variant. Categories separate by
 * **value**, not hue: emphasis descends the ink scale (`foreground` fill →
 * `muted` fill → outline → quiet `muted-foreground`), and `destructive` is the
 * one chromatic note, reserved for danger (DESIGN.md §2).
 *
 * Adapted from [shadcn Badge › Custom Colors](https://ui.shadcn.com/docs/components/base/badge#custom-colors),
 * which recolors badges with the raw Tailwind palette (`bg-blue-50 text-blue-700
 * dark:bg-blue-950 dark:text-blue-300`, …) — forbidden by DESIGN.md §2/§6, and
 * the anti-pattern this story now demonstrates the sanctioned replacement for.
 *
 * @summary for badges using custom color classes beyond the variant scale
 */
export const Colors: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // `destructive` renders destructive ink on `bg-destructive/10` at `text-xs`
  // (~4:1), the #232 token pairing `Basic`/`Variants` already suppress.
  parameters: contrastKnownIssue232,
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge className="bg-foreground text-background">Blocker</Badge>
      <Badge className="bg-muted text-foreground">Major</Badge>
      <Badge variant="outline">Minor</Badge>
      <Badge className="text-muted-foreground" variant="ghost">
        Trivial
      </Badge>
      <Badge variant="destructive">Regression</Badge>
    </div>
  ),
};
