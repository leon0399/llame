import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
} from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert.js";
import { Button } from "./button.js";
import { contrastKnownIssue232 } from "./known-a11y-issues.js";

// Every story in this file is transcribed verbatim from the shadcn Alert docs
// examples (https://ui.shadcn.com/docs/components/radix/alert), so the file
// carries the "shadcn-example" provenance tag on each transcribed story.
//
// `alert-rtl` is skipped by convention (RTL demo). `Destructive`'s description
// (`text-destructive/90` on the card surface) fails WCAG AA color-contrast
// (4.49:1) — a real token defect tracked in #232; pending the token fix it
// ships with `contrastKnownIssue232` suppressing only the `color-contrast`
// rule. (`AlertAction` was backported to alert.tsx so the `alert-action`
// example — previously skipped as an API gap — is now covered.)
const meta = {
  component: Alert,
  subcomponents: { AlertTitle, AlertDescription, AlertAction },
  parameters: {
    layout: "centered",
  },
  // Alert is a block/full-width component; mirror the docs' single centered
  // preview frame instead of letting each example's own max-w-md grow or
  // shrink independently.
  decorators: [
    (Story) => (
      <div className="w-[28rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof Alert>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use for stacking multiple independent alerts — e.g. a payment confirmation
 * beside an unrelated product announcement — each with its own icon, title,
 * and description.
 *
 * Verbatim from [shadcn Alert demo](https://ui.shadcn.com/docs/components/radix/alert)
 * (the default example at the top of the page, before any heading).
 *
 * @summary for stacking multiple independent alerts
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <div className="grid items-start gap-4">
      <Alert>
        <CheckCircle2Icon />
        <AlertTitle>Payment successful</AlertTitle>
        <AlertDescription>
          Your payment of $29.99 has been processed. A receipt has been sent to
          your email address.
        </AlertDescription>
      </Alert>
      <Alert>
        <InfoIcon />
        <AlertTitle>New feature available</AlertTitle>
        <AlertDescription>
          We&apos;ve added dark mode support. You can enable it in your account
          settings.
        </AlertDescription>
      </Alert>
    </div>
  ),
};

/**
 * Use for the minimal case: a single alert with an icon, title, and
 * description, using the default `variant`.
 *
 * Verbatim from [shadcn Alert › Basic](https://ui.shadcn.com/docs/components/radix/alert#basic).
 *
 * @summary for a single default-variant alert
 */
export const SingleAlert: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    children: (
      <>
        <CheckCircle2Icon />
        <AlertTitle>Account updated successfully</AlertTitle>
        <AlertDescription>
          Your profile information has been saved. Changes will be reflected
          immediately.
        </AlertDescription>
      </>
    ),
  },
};

/**
 * Use `variant="destructive"` for an error or failed outcome — e.g. a declined
 * payment or a blocked action.
 *
 * Verbatim from [shadcn Alert › Destructive](https://ui.shadcn.com/docs/components/radix/alert#destructive).
 *
 * @summary for an error / failed-outcome alert
 */
export const Destructive: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // #232: the destructive description (text-destructive/90 on card) fails
  // color-contrast at 4.49:1 — real token defect, suppress only that rule.
  parameters: contrastKnownIssue232,
  args: {
    variant: "destructive",
    children: (
      <>
        <AlertCircleIcon />
        <AlertTitle>Payment failed</AlertTitle>
        <AlertDescription>
          Your payment could not be processed. Please check your payment method
          and try again.
        </AlertDescription>
      </>
    ),
  },
};

/**
 * Custom colors are applied directly via `className` (e.g.
 * `border-amber-200 bg-amber-50 text-amber-900` with dark-mode counterparts)
 * since `variant` only covers `default`/`destructive` — use this for a
 * warning tone the built-in variants don't provide.
 *
 * Verbatim from [shadcn Alert › Custom Colors](https://ui.shadcn.com/docs/components/radix/alert#custom-colors).
 *
 * @summary for a custom warning tone via className
 */
export const Colors: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    className:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50",
    children: (
      <>
        <AlertTriangleIcon />
        <AlertTitle>Your subscription will expire in 3 days.</AlertTitle>
        <AlertDescription>
          Renew now to avoid service interruption or upgrade to a paid plan to
          continue using the service.
        </AlertDescription>
      </>
    ),
  },
};

/**
 * Use `AlertAction` to place a small action button in the top-right of the
 * alert — a one-tap way to act on the callout without leaving it. The Alert
 * reserves right padding so the action never overlaps the title or text.
 *
 * Verbatim from [shadcn Alert › Action](https://ui.shadcn.com/docs/components/radix/alert#action).
 *
 * @summary for an alert with a top-right action button
 */
export const Action: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    children: (
      <>
        <AlertTitle>Dark mode is now available</AlertTitle>
        <AlertDescription>
          Enable it under your profile settings to get started.
        </AlertDescription>
        <AlertAction>
          <Button size="xs" variant="default">
            Enable
          </Button>
        </AlertAction>
      </>
    ),
  },
};
