import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { toast } from "sonner";
import { expect, screen } from "storybook/test";

import { Button } from "./button.js";
import { Toaster } from "./sonner.js";

// All four stories below are transcribed from the shadcn Sonner docs
// (https://ui.shadcn.com/docs/components/radix/sonner), so the file carries
// the "shadcn-example" provenance tag at the meta level. `toast()` is
// imported directly from the `sonner` package (not re-exported with a
// wrapper), matching upstream's usage. There is no RTL variant of these
// examples upstream, so nothing is skipped for that reason. Toasts render
// via a portal, so every story's decorator mounts our `<Toaster />` next to
// the trigger, and `play` functions query `document.body` through
// `screen` rather than the story's own `canvas`.
// Annotated with `Meta<typeof Toaster>` rather than the usual `satisfies`:
// sonner's `ToasterProps` references `ToastIcons`/`ToastOptions`, which the
// `sonner` package does not export, so the narrow literal type `satisfies`
// preserves cannot be named when `meta` is exported (TS4023). The explicit
// annotation uses the nameable `Meta<…>` alias instead. Safe here because
// every story is `render`-only (no args to infer).
const meta: Meta<typeof Toaster> = {
  component: Toaster,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs", "shadcn-example"],
  decorators: [
    (Story) => (
      <>
        <Story />
        <Toaster />
      </>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The default toast: a title, a supporting description, and an inline
 * action. Requires a `<Toaster />` mounted once in the app (e.g. the root
 * layout) — `toast()` itself is imported directly from the `sonner`
 * package, not from this file.
 *
 * Verbatim from [shadcn Sonner](https://ui.shadcn.com/docs/components/radix/sonner)
 * (the default example at the top of the page).
 *
 * @summary for the default toast with description and action
 */
export const Basic: Story = {
  render: () => (
    <Button
      variant="outline"
      onClick={() =>
        toast("Event has been created", {
          description: "Sunday, December 03, 2023 at 9:00 AM",
          action: {
            label: "Undo",
            onClick: () => console.log("Undo"),
          },
        })
      }
    >
      Show Toast
    </Button>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Show Toast" }));

    await expect(
      await screen.findByText("Event has been created"),
    ).toBeInTheDocument();
  },
};

/**
 * The toast type scale — default, success, info, warning, and error, plus a
 * `promise` toast that transitions through loading/success/error states as
 * the underlying promise settles.
 *
 * Verbatim from [shadcn Sonner › Types](https://ui.shadcn.com/docs/components/radix/sonner#types).
 *
 * @summary reference of the toast type scale
 */
export const Types: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => toast("Event has been created")}>
        Default
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.success("Event has been created")}
      >
        Success
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.info("Be at the area 10 minutes before the event time")
        }
      >
        Info
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.warning("Event start time cannot be earlier than 8am")
        }
      >
        Warning
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.error("Event has not been created")}
      >
        Error
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          toast.promise<{ name: string }>(
            () =>
              new Promise((resolve) =>
                setTimeout(() => resolve({ name: "Event" }), 2000),
              ),
            {
              loading: "Loading...",
              success: (data) => `${data.name} has been created`,
              error: "Error",
            },
          );
        }}
      >
        Promise
      </Button>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Warning" }));

    await expect(
      await screen.findByText("Event start time cannot be earlier than 8am"),
    ).toBeInTheDocument();
  },
};

/**
 * Use a description when the toast's title needs a supporting detail line
 * beneath it.
 *
 * Verbatim from [shadcn Sonner › Description](https://ui.shadcn.com/docs/components/radix/sonner#description).
 *
 * @summary for a toast with a supporting description line
 */
export const WithDescription: Story = {
  render: () => (
    <Button
      onClick={() =>
        toast("Event has been created", {
          description: "Monday, January 3rd at 6:00pm",
        })
      }
      variant="outline"
      className="w-fit"
    >
      Show Toast
    </Button>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Show Toast" }));

    const toastTitle = await screen.findByText("Event has been created");
    await expect(toastTitle).toBeInTheDocument();
    await expect(
      screen.getByText("Monday, January 3rd at 6:00pm"),
    ).toBeInTheDocument();
  },
};

/**
 * Use the per-call `position` option to override where a single toast
 * renders, independent of the `<Toaster />`'s own default position.
 *
 * Verbatim from [shadcn Sonner › Position](https://ui.shadcn.com/docs/components/radix/sonner#position).
 *
 * @summary reference of the toast position options
 */
export const Position: Story = {
  render: () => (
    <div className="flex flex-wrap justify-center gap-2">
      <Button
        variant="outline"
        onClick={() =>
          toast("Event has been created", { position: "top-left" })
        }
      >
        Top Left
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast("Event has been created", { position: "top-center" })
        }
      >
        Top Center
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast("Event has been created", { position: "top-right" })
        }
      >
        Top Right
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast("Event has been created", { position: "bottom-left" })
        }
      >
        Bottom Left
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast("Event has been created", { position: "bottom-center" })
        }
      >
        Bottom Center
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast("Event has been created", { position: "bottom-right" })
        }
      >
        Bottom Right
      </Button>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Top Right" }));

    await expect(
      await screen.findByText("Event has been created"),
    ).toBeInTheDocument();
  },
};
