import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChevronDownIcon, DotIcon } from "lucide-react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./breadcrumb.js";
import { Button } from "./button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";

// Every story here is transcribed from the shadcn Breadcrumb docs examples
// (https://ui.shadcn.com/docs/components/base/breadcrumb). Adapted: upstream's
// `next/link` renders are plain `<a>` with fragment hrefs (as in the badge
// story), and the dropdown's bare trigger gets `type="button"`.
// Skipped: breadcrumb-rtl (RTL is excluded by convention).
const meta = {
  component: Breadcrumb,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Breadcrumb>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * A trail of links ending at the current page, which reads as plain text in
 * regular weight and is marked `aria-current="page"`.
 * Verbatim from [shadcn Breadcrumb › Basic](https://ui.shadcn.com/docs/components/base/breadcrumb#basic).
 *
 * @summary a trail of links ending at the current page
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#">Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="#">Components</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Breadcrumb</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      canvas.getByRole("navigation", { name: "breadcrumb" }),
    ).toBeVisible();
    await expect(canvas.getAllByRole("link")).toHaveLength(2);
    await expect(canvas.getByText("Breadcrumb")).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
};

/**
 * A collapsed middle step behind a menu of the hidden pages.
 * Verbatim from [shadcn Breadcrumb](https://ui.shadcn.com/docs/components/base/breadcrumb).
 *
 * @summary collapsed steps opened from a menu
 */
export const WithMenu: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<a href="#" />}>Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="icon-sm" variant="ghost" />}
            >
              <BreadcrumbEllipsis />
              <span className="sr-only">Toggle menu</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <DropdownMenuItem>Documentation</DropdownMenuItem>
                <DropdownMenuItem>Themes</DropdownMenuItem>
                <DropdownMenuItem>GitHub</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink render={<a href="#" />}>Components</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Breadcrumb</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Toggle menu" }),
    );
    const item = await screen.findByRole("menuitem", { name: "Themes" });

    // The popup fades in; wait for it rather than for its first frame.
    await waitFor(() => expect(item).toBeVisible());
  },
};

/**
 * A custom separator passed as the separator's child.
 * Verbatim from [shadcn Breadcrumb › Custom separator](https://ui.shadcn.com/docs/components/base/breadcrumb#custom-separator).
 *
 * @summary a trail with a custom separator icon
 */
export const CustomSeparator: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<a href="#home" />}>Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>
          <DotIcon />
        </BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbLink render={<a href="#components" />}>
            Components
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>
          <DotIcon />
        </BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbPage>Breadcrumb</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};

/**
 * A step that opens a menu of sibling pages.
 * Verbatim from [shadcn Breadcrumb › Dropdown](https://ui.shadcn.com/docs/components/base/breadcrumb#dropdown).
 *
 * @summary a step that opens a menu of siblings
 */
export const Dropdown: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<a href="#home" />}>Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>
          <DotIcon />
        </BreadcrumbSeparator>
        <BreadcrumbItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button type="button" className="flex items-center gap-1" />
              }
            >
              Components
              <ChevronDownIcon data-icon="inline-end" className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <DropdownMenuItem>Documentation</DropdownMenuItem>
                <DropdownMenuItem>Themes</DropdownMenuItem>
                <DropdownMenuItem>GitHub</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </BreadcrumbItem>
        <BreadcrumbSeparator>
          <DotIcon />
        </BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbPage>Breadcrumb</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};

/**
 * A long trail with its middle steps collapsed to an ellipsis.
 * Verbatim from [shadcn Breadcrumb › Collapsed](https://ui.shadcn.com/docs/components/base/breadcrumb#collapsed).
 *
 * @summary a long trail with collapsed middle steps
 */
export const Collapsed: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<a href="#home" />}>Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbEllipsis />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink render={<a href="#components" />}>
            Components
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Breadcrumb</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};

/**
 * Steps rendered through a routing link component via `render`.
 * Verbatim from [shadcn Breadcrumb › Link component](https://ui.shadcn.com/docs/components/base/breadcrumb#link-component).
 *
 * @summary steps rendered through a routing link
 */
export const LinkComponent: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<a href="#link-component" />}>
            Home
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink render={<a href="#link-component" />}>
            Components
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Breadcrumb</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};
