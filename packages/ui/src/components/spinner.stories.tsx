import { LoaderIcon } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Badge } from "./badge.js";
import { Button } from "./button.js";
import { Spinner } from "./spinner.js";

// Every story here is transcribed from the shadcn Spinner docs examples
// (https://ui.shadcn.com/docs/components/base/spinner), so the file carries
// the "shadcn-example" provenance tag on each transcribed story.
//
// Spinner is a tiny atom with no props beyond `className`, so Basic renders
// the docs' own `## Usage` snippet (`<Spinner />`) rather than the page's
// lead `ComponentPreview` (`spinner-demo`): that demo composes `Item` /
// `ItemContent` / `ItemMedia` / `ItemTitle`, a companion component we have
// not vendored. Two further examples are skipped for the same reason —
// `spinner-empty` (`Empty` / `EmptyHeader` / `EmptyMedia` / `EmptyTitle` /
// `EmptyDescription` / `EmptyContent`) and `spinner-input-group`
// (`InputGroup` / `InputGroupAddon` / `InputGroupInput` / `InputGroupButton`
// / `InputGroupTextarea`) — three vendored-companion gaps on this page (see
// packages/ui/AGENTS.md "Cover the upstream examples"). RTL is skipped by
// convention.
//
// `spinner-button.tsx` / `spinner-badge.tsx` below are this page's own
// Button/Badge sections. They are distinct files from `button-spinner.tsx` /
// `badge-spinner.tsx`, which illustrate the Button/Badge docs pages instead
// (badge.stories.tsx's `WithSpinner` is sourced from the latter).
const meta = {
  component: Spinner,
  parameters: {
    layout: "centered",
    // The spinner continuously rotates (animate-spin), so a screenshot captures
    // a nondeterministic animation frame. Skip screenshot capture for the whole
    // file (interaction/render still runs).
    visualTests: { disable: true },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Spinner>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The bare spinner, for the default in-progress indicator with no
 * composition.
 *
 * Verbatim from the [shadcn Spinner › Usage](https://ui.shadcn.com/docs/components/base/spinner#usage)
 * snippet — the page's own `ComponentPreview` demo instead composes `Item`,
 * a companion component we have not vendored (see the file-level note
 * above).
 *
 * @summary for the default, unadorned loading indicator
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => <Spinner />,
};

/**
 * The `size-*` utility scale for the spinner, from compact inline use up to
 * a page-level loading state.
 *
 * Verbatim from [shadcn Spinner › Size](https://ui.shadcn.com/docs/components/base/spinner#size).
 *
 * @summary reference of the spinner size scale via size-*
 */
export const Sizes: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <div className="flex items-center gap-6">
      <Spinner className="size-3" />
      <Spinner className="size-4" />
      <Spinner className="size-6" />
      <Spinner className="size-8" />
    </div>
  ),
};

/**
 * Swap the spinner's icon by forking the component — here `LoaderIcon` in
 * place of the vendored `Loader2Icon` — for a project that wants a
 * different loading glyph everywhere.
 *
 * Verbatim from [shadcn Spinner › Customization](https://ui.shadcn.com/docs/components/base/spinner#customization).
 *
 * @summary for forking the icon a spinner renders
 */
export const Custom: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <div className="flex items-center gap-4">
      <LoaderIcon
        role="status"
        aria-label="Loading"
        className="size-4 animate-spin"
      />
    </div>
  ),
};

/**
 * Place the spinner before or after a Button's label with
 * `data-icon="inline-start"` / `data-icon="inline-end"` to show the button
 * is busy; pair it with `disabled` so the action can't be retriggered.
 *
 * Verbatim from [shadcn Spinner › Button](https://ui.shadcn.com/docs/components/base/spinner#button).
 *
 * @summary for a busy, disabled button while an action is in flight
 */
export const InButton: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <div className="flex flex-col items-center gap-4">
      <Button disabled size="sm">
        <Spinner data-icon="inline-start" />
        Loading...
      </Button>
      <Button variant="outline" disabled size="sm">
        <Spinner data-icon="inline-start" />
        Please wait
      </Button>
      <Button variant="secondary" disabled size="sm">
        <Spinner data-icon="inline-start" />
        Processing
      </Button>
    </div>
  ),
};

/**
 * Place the spinner before a Badge's label with `data-icon="inline-start"`
 * to show a background operation is in progress.
 *
 * Verbatim from [shadcn Spinner › Badge](https://ui.shadcn.com/docs/components/base/spinner#badge).
 *
 * @summary for a badge showing a background operation in progress
 */
export const InBadge: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <div className="flex items-center gap-4 [--radius:1.2rem]">
      <Badge>
        <Spinner data-icon="inline-start" />
        Syncing
      </Badge>
      <Badge variant="secondary">
        <Spinner data-icon="inline-start" />
        Updating
      </Badge>
      <Badge variant="outline">
        <Spinner data-icon="inline-start" />
        Processing
      </Badge>
    </div>
  ),
};
