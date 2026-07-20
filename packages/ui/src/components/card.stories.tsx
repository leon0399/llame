import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Badge } from "./badge.js";
import { Button } from "./button.js";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card.js";
import { Input } from "./input.js";
import { Label } from "./label.js";

// Every story in this file is transcribed verbatim from the shadcn Card docs
// examples (https://ui.shadcn.com/docs/components/radix/card), so the file
// carries the "shadcn-example" provenance tag on each transcribed story. RTL is
// skipped by convention.
//
// The `size` prop, the `--card-spacing` CSS variable, and the image-rounding
// (`overflow-hidden` + `*:[img:first-child]:rounded-t-xl`) had lagged upstream
// in our vendored `card.tsx`; they are now backported, so `Small`, `EdgeToEdge`,
// and `WithImage` render as the docs intend rather than as inert default cards.
// `--card-spacing` matches the docs' spacing scale — default `1rem`, and
// `size="sm"` tightens it to `0.75rem`.
//
// Skipped: `card-spacing` (the interactive Spacing playground) wires a
// `ToggleGroup` to `--card-spacing` to demo the variable live — it crosses
// multiple components/concepts in a single example (a stories.md anti-pattern).
// The `--card-spacing` concept itself is shown statically by `EdgeToEdge`.
const meta = {
  component: Card,
  subcomponents: {
    CardHeader,
    CardTitle,
    CardDescription,
    CardAction,
    CardContent,
    CardFooter,
  },
  parameters: {
    layout: "centered",
  },
  // Mirror the docs' ComponentPreview frame: center each example and
  // width-constrain it to a single width matching upstream's own
  // `max-w-sm` (24rem), so per-example width classes render uniformly here
  // instead of each story picking its own size.
  decorators: [
    (Story) => (
      <div className="w-[24rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use for a self-contained content block combining a header, form-style
 * body, and footer actions — the standard Card composition. Upstream fixes
 * a `max-w-sm` width on top of `w-full`; here the meta decorator's frame
 * owns the outer constraint instead.
 *
 * Verbatim from [shadcn Card demo](https://ui.shadcn.com/docs/components/radix/card)
 * (the default example at the top of the page, before any heading).
 *
 * @summary for the standard header + content + footer composition
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Login to your account</CardTitle>
        <CardDescription>
          Enter your email below to login to your account
        </CardDescription>
        <CardAction>
          <Button variant="link">Sign Up</Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <form>
          <div className="flex flex-col gap-6">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="m@example.com"
                required
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center">
                <Label htmlFor="password">Password</Label>
                <a
                  href="#"
                  className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                >
                  Forgot your password?
                </a>
              </div>
              <Input id="password" type="password" required />
            </div>
          </div>
        </form>
      </CardContent>
      <CardFooter className="flex-col gap-2">
        <Button type="submit" className="w-full">
          Login
        </Button>
        <Button variant="outline" className="w-full">
          Login with Google
        </Button>
      </CardFooter>
    </Card>
  ),
};

/**
 * Use `size="sm"` for a more compact card — it tightens `--card-spacing` so
 * the header, content, and footer gaps and padding all shrink together.
 *
 * Verbatim from [shadcn Card › Size](https://ui.shadcn.com/docs/components/radix/card#size).
 *
 * @summary for a compact, tighter-spaced card
 */
export const Small: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle>Small Card</CardTitle>
        <CardDescription>
          This card uses the small size variant.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p>
          The card component supports a size prop that can be set to
          &quot;sm&quot; for a more compact appearance.
        </p>
      </CardContent>
      <CardFooter>
        <Button variant="outline" size="sm" className="w-full">
          Action
        </Button>
      </CardFooter>
    </Card>
  ),
};

/**
 * Use negative margins keyed to `--card-spacing` (`-mx-(--card-spacing)`) to
 * break a section out to the card's edges while staying aligned with the
 * inset — e.g. a scrollable region with its own background. Pair with
 * `-mb-(--card-spacing)` on `CardContent` when the edge-to-edge block sits
 * directly above the footer, to remove the section gap.
 *
 * Verbatim from [shadcn Card › Spacing](https://ui.shadcn.com/docs/components/radix/card#spacing),
 * with `tabIndex`/`role="region"`/`aria-label` added to the scroll container:
 * upstream's example leaves the `overflow-y-scroll` region non-focusable, so
 * keyboard users can't scroll it — the minimum fix our a11y gate requires.
 *
 * @summary for content that breaks out to the card's edges
 */
export const EdgeToEdge: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Terms of Service</CardTitle>
        <CardDescription>
          Review the terms before accepting the agreement.
        </CardDescription>
      </CardHeader>
      <CardContent className="-mb-(--card-spacing)">
        <div
          tabIndex={0}
          role="region"
          aria-label="Terms of Service"
          className="-mx-(--card-spacing) max-h-48 space-y-4 overflow-y-scroll border-t bg-muted/50 px-(--card-spacing) py-4 text-sm leading-relaxed"
        >
          <p>
            These terms govern your use of the workspace, including access to
            shared documents, project files, and collaboration tools.
          </p>
          <p>
            You are responsible for the content you upload and for ensuring that
            your team has the appropriate permissions to view or edit it.
          </p>
          <p>
            We may update features or limits as the service evolves. When those
            changes materially affect your workflow, we will notify your
            workspace administrators.
          </p>
          <p>
            By continuing, you agree to keep your account credentials secure and
            to follow your organization&apos;s acceptable use policies.
          </p>
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline">Decline</Button>
        <Button>Accept</Button>
      </CardFooter>
    </Card>
  ),
};

/**
 * Use to lead a Card with a cover image above the header — e.g. an event or
 * article preview. The Card's `overflow-hidden` rounds the image's top corners
 * to match, and `pt-0` (with the Card's `has-[>img:first-child]:pt-0`) lets the
 * image sit flush to the top edge. Upstream fixes `max-w-sm` on top of `w-full`
 * and centers with `mx-auto`; here the meta decorator's frame owns centering
 * and the outer width constraint instead.
 *
 * Verbatim from [shadcn Card › Image](https://ui.shadcn.com/docs/components/radix/card#image).
 *
 * @summary for a card led by a cover image
 */
export const WithImage: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Card className="relative w-full pt-0">
      <div className="absolute inset-0 z-30 aspect-video bg-black/35" />
      <img
        src="https://avatar.vercel.sh/shadcn1"
        alt="Event cover"
        className="relative z-20 aspect-video w-full object-cover brightness-60 grayscale dark:brightness-40"
      />
      <CardHeader>
        <CardAction>
          <Badge variant="secondary">Featured</Badge>
        </CardAction>
        <CardTitle>Design systems meetup</CardTitle>
        <CardDescription>
          A practical talk on component APIs, accessibility, and shipping
          faster.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button className="w-full">View Event</Button>
      </CardFooter>
    </Card>
  ),
};
