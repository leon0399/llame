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
// carries the "shadcn-example" provenance tag at the meta level. RTL is
// skipped by convention.
//
// Three upstream examples are skipped as genuine API gaps, not oversights:
// `card-small` (Size), `card-spacing` (Spacing), and `card-edge-to-edge`
// (the second Spacing preview). All three depend on features our vendored
// `card.tsx` predates — the `size` prop and the `--card-spacing` CSS
// variable the mdx's own "Changelog: Spacing Variable" section documents as
// an upstream addition. Transcribing them verbatim would render as plain
// default cards (`size="sm"` forwards as an inert div attribute; the
// `--card-spacing`-based classes resolve to nothing since our subcomponents
// use hardcoded `px-6`/`py-6`), silently demonstrating a concept the
// component doesn't support — see Card's JSDoc for the same gap noted at
// the source.
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
  tags: ["autodocs", "shadcn-example"],
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
 * Use to lead a Card with a cover image above the header — e.g. an event or
 * article preview. Upstream fixes a `max-w-sm` width on top of `w-full` and
 * centers with `mx-auto`; here the meta decorator's frame owns centering and
 * the outer width constraint instead. Note: our vendored `Card` lacks
 * upstream's `overflow-hidden` and `*:[img:first-child]:rounded-t-xl`, so the
 * image's top corners overshoot the card's rounding slightly — a cosmetic
 * gap, not a functional one (unlike the three skipped examples above).
 *
 * Verbatim from [shadcn Card › Image](https://ui.shadcn.com/docs/components/radix/card#image).
 *
 * @summary for a card led by a cover image
 */
export const WithImage: Story = {
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
