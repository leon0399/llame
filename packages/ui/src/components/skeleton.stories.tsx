import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Card, CardContent, CardHeader } from "./card.js";
import { Skeleton } from "./skeleton.js";

// Every story in this file is transcribed verbatim from the shadcn Skeleton
// docs examples (https://ui.shadcn.com/docs/components/radix/skeleton), so
// the file carries the "shadcn-example" provenance tag at the meta level.
// Skeleton examples are plain divs (skeleton-card composes our vendored
// Card/CardHeader/CardContent; skeleton-table renders its own grid of divs
// and does not depend on a Table component), so every non-RTL example is
// compatible. RTL is skipped by convention.
const meta = {
  component: Skeleton,
  parameters: {
    layout: "centered",
  },
  // Skeletons are block placeholders whose own dimensions ARE the concept
  // being demonstrated. Give every story one fixed frame like the docs'
  // centered preview, and strip only the *outer container* max-w/w-full
  // classes that would otherwise cap or blow out that frame — the
  // Skeleton elements' own h-*/w-* classes (their placeholder shape) are
  // left untouched.
  decorators: [
    (Story) => (
      <div className="w-[24rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs", "shadcn-example"],
} satisfies Meta<typeof Skeleton>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use a shape-matched Skeleton in place of each piece of content — an
 * avatar-sized circle beside two lines of text — while the real data is
 * still loading.
 *
 * Adapted from [shadcn Skeleton demo](https://ui.shadcn.com/docs/components/radix/skeleton)
 * (the default example at the top of the page, before any heading).
 *
 * @summary for the standard loading placeholder
 */
export const Basic: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Skeleton className="h-12 w-12 rounded-full" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-[250px]" />
        <Skeleton className="h-4 w-[200px]" />
      </div>
    </div>
  ),
};

/**
 * Use for a user/entity row — a circular avatar placeholder beside a name
 * and a secondary line.
 *
 * Adapted from [shadcn Skeleton › Avatar](https://ui.shadcn.com/docs/components/radix/skeleton#avatar).
 *
 * @summary for an avatar-plus-two-lines loading row
 */
export const Avatar: Story = {
  render: () => (
    <div className="flex w-fit items-center gap-4">
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="grid gap-2">
        <Skeleton className="h-4 w-[150px]" />
        <Skeleton className="h-4 w-[100px]" />
      </div>
    </div>
  ),
};

/**
 * Use to mirror a Card's layout — header lines plus a media block — while
 * its content is still loading.
 *
 * Adapted from [shadcn Skeleton › Card](https://ui.shadcn.com/docs/components/radix/skeleton#card).
 *
 * @summary for a Card-shaped loading placeholder
 */
export const CardSkeleton: Story = {
  render: () => (
    <Card className="w-full">
      <CardHeader>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </CardHeader>
      <CardContent>
        <Skeleton className="aspect-video w-full" />
      </CardContent>
    </Card>
  ),
};

/**
 * Use a stack of full-width lines, with a shorter final line, to placeholder
 * a paragraph of text.
 *
 * Adapted from [shadcn Skeleton › Text](https://ui.shadcn.com/docs/components/radix/skeleton#text).
 *
 * @summary for a multi-line paragraph loading placeholder
 */
export const Text: Story = {
  render: () => (
    <div className="flex w-full flex-col gap-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  ),
};

/**
 * Use paired label/field placeholders to mirror a form's layout while its
 * fields are still loading.
 *
 * Adapted from [shadcn Skeleton › Form](https://ui.shadcn.com/docs/components/radix/skeleton#form).
 *
 * @summary for a form-shaped loading placeholder
 */
export const Form: Story = {
  render: () => (
    <div className="flex w-full flex-col gap-7">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-full" />
      </div>
      <Skeleton className="h-8 w-24" />
    </div>
  ),
};

/**
 * Use repeated row placeholders, each with fixed and flexible-width cells,
 * to mirror a table's layout while its rows are still loading.
 *
 * Adapted from [shadcn Skeleton › Table](https://ui.shadcn.com/docs/components/radix/skeleton#table).
 *
 * @summary for a table-row-shaped loading placeholder
 */
export const Table: Story = {
  render: () => (
    <div className="flex w-full flex-col gap-2">
      {Array.from({ length: 5 }).map((_, index) => (
        <div className="flex gap-4" key={index}>
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  ),
};
