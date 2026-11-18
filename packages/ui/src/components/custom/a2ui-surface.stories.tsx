import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { A2uiSurface, a2uiSurfaceSchema } from "./a2ui-surface.js";

// A2uiSurface is this package's own renderer for the display-only A2UI v0.9
// subset the `render_ui` tool accepts, so the stories carry only
// "ai-generated".
const meta = {
  component: A2uiSurface,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[36rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof A2uiSurface>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use a card with a repeated row for a set of items that share fields: the
 * agent sends one row template and the data, not one component per item.
 *
 * @summary for a card whose rows repeat over a data array
 */
export const PullRequestList: Story = {
  tags: ["ai-generated"],
  args: {
    surface: a2uiSurfaceSchema.parse({
      components: [
        { id: "root", component: "Card", child: "body" },
        {
          id: "body",
          component: "Column",
          children: ["title", "caption", "rule", "rows"],
        },
        {
          id: "title",
          component: "Text",
          text: { path: "/title" },
          variant: "h4",
        },
        {
          id: "caption",
          component: "Text",
          text: "Sorted by last update",
          variant: "caption",
        },
        { id: "rule", component: "Divider" },
        {
          id: "rows",
          component: "List",
          children: { componentId: "row", path: "/pulls" },
        },
        {
          id: "row",
          component: "Row",
          children: ["name", "state"],
          justify: "spaceBetween",
          align: "center",
        },
        { id: "name", component: "Text", text: { path: "name" } },
        {
          id: "state",
          component: "Text",
          text: { path: "state" },
          variant: "caption",
        },
      ],
      data: {
        title: "Open pull requests",
        pulls: [
          { name: "#1744 compact at a step boundary", state: "approved" },
          { name: "#1751 archive add-slash-commands", state: "in review" },
          { name: "#1760 stream Runs as AG-UI", state: "draft" },
        ],
      },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Open pull requests")).toBeVisible();
    // One row per item, each reading its own fields.
    await expect(canvas.getByText("#1760 stream Runs as AG-UI")).toBeVisible();
    await expect(canvas.getAllByText(/approved|in review|draft/)).toHaveLength(
      3,
    );
  },
};

/**
 * A surface whose components name each other in a loop, or name an id that
 * does not exist, paints what it can and stops: the renderer does not trust
 * the list it is given.
 *
 * @summary a component cycle or a missing id renders nothing for that branch
 */
export const BrokenReferences: Story = {
  tags: ["ai-generated"],
  args: {
    surface: a2uiSurfaceSchema.parse({
      components: [
        {
          id: "root",
          component: "Column",
          children: ["shown", "loop", "gone"],
        },
        { id: "shown", component: "Text", text: "Still rendered" },
        { id: "loop", component: "Card", child: "root" },
        { id: "unbound", component: "Text", text: { path: "/missing" } },
      ],
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText("Still rendered")).toHaveLength(1);
  },
};

/**
 * A surface that repeats a row inside itself asks for more components than any
 * page should paint. The renderer stops at its own budget instead of freezing.
 *
 * @summary nested repetition stops at the render budget
 */
export const RenderBudget: Story = {
  tags: ["ai-generated"],
  args: {
    surface: a2uiSurfaceSchema.parse({
      components: [
        {
          id: "root",
          component: "List",
          children: { componentId: "outer", path: "/rows" },
        },
        {
          id: "outer",
          component: "List",
          children: { componentId: "inner", path: "/rows" },
        },
        {
          id: "inner",
          component: "List",
          children: { componentId: "cell", path: "/rows" },
        },
        { id: "cell", component: "Text", text: "cell" },
      ],
      // 200 x 200 x 200 cells if nothing stopped it.
      data: { rows: Array.from({ length: 200 }, (_, index) => index) },
    }),
  },
  play: async ({ canvas }) => {
    const cells = canvas.getAllByText("cell");

    await expect(cells.length).toBeGreaterThan(0);
    await expect(cells.length).toBeLessThanOrEqual(1000);
  },
};
