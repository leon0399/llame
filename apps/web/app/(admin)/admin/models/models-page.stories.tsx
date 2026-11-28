import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { vi } from "vitest";

import type {
  AvailableModelResponse,
  ModelsResponse,
} from "@/lib/api/generated/models";
// Import through the real specifier: sb.mock redirects it to the controllable
// mock registered in preview.tsx, so the page and these stories agree on the
// hook.
import * as modelQueries from "@/lib/services/models/queries";

import AdminModelsPage from "./page";

const useModelsQuery = vi.mocked(modelQueries.useModelsQuery, {
  partial: true,
});

function model(
  overrides: Partial<AvailableModelResponse> & { id: string },
): AvailableModelResponse {
  return {
    source: "system",
    contextWindowTokens: 200_000,
    input: ["text"],
    ...overrides,
  };
}

const hy4 = model({
  id: "system:opencode-go:hy4-flash",
  name: "Hy4 Flash (Go)",
  input: ["text", "image"],
});

const deepseek = model({
  id: "system:opencode-go:deepseek-v4.1-flash",
  name: "DeepSeek V4.1 Flash (Go)",
  description: "Fast general model on the Go subscription.",
  contextWindowTokens: 1_000_000,
  pricingUsdPer1M: { input: 0.14, cachedInput: 0.03, output: 0.28 },
  reasoning: {
    effortLevels: [{ value: "low" }, { value: "medium" }, { value: "high" }],
    defaultEffort: "medium",
    cacheInvalidatedByEffortChange: false,
  },
  knowledgeCutoff: "2026-03-01",
  releasedAt: "2026-06-15",
  apiDocs: "https://example.com/docs",
  modelPage: "https://example.com/model",
});

const luna = model({
  id: "system:codex:gpt-6-luna",
  name: "GPT-6 Luna",
  input: ["text", "pdf"],
});

const catalog: ModelsResponse = {
  defaultSelector: deepseek.id,
  models: [hy4, deepseek, luna],
  roles: [
    {
      selector: "@small",
      candidates: [
        { modelId: hy4.id, paid: false },
        { modelId: deepseek.id, effort: "low", paid: false },
        { modelId: luna.id, paid: true },
      ],
    },
  ],
};

function served(data: ModelsResponse) {
  useModelsQuery.mockReturnValue({
    data,
    isPending: false,
    isError: false,
  });
}

/** The section whose heading reads `name`. */
function section(canvasElement: HTMLElement, name: RegExp) {
  const heading = within(canvasElement).getByRole("heading", { name });
  const element = heading.closest("section");

  if (element === null) throw new Error(`no section for ${String(name)}`);

  return within(element);
}

const meta = {
  component: AdminModelsPage,
  tags: ["autodocs"],
  beforeEach: () => {
    served(catalog);
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AdminModelsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * A role is its fallback chain, top to bottom: numbered steps, the first
 * marked Primary and the rest Fallback, each with its effort and a Paid mark
 * where the role allows paid fallback, and the model id under each name.
 *
 * @summary a model role drawn as a numbered fallback chain
 */
export const RoleChain: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const roles = section(canvasElement, /^Model roles$/);
    const chain = roles.getByRole("list", { name: "@small fallback order" });
    const steps = within(chain).getAllByRole("listitem");

    await expect(steps).toHaveLength(3);
    await expect(steps[0]).toHaveTextContent("Hy4 Flash (Go)");
    await expect(steps[0]).toHaveTextContent("Primary");
    await expect(steps[0]).toHaveTextContent(hy4.id);
    await expect(steps[1]).toHaveTextContent("Fallback");
    await expect(steps[1]).toHaveTextContent("effort low");
    await expect(steps[2]).toHaveTextContent("Paid");
    await expect(steps[0]).not.toHaveTextContent("Paid");
  },
};

/**
 * An instance with no roles says so instead of an empty card.
 *
 * @summary the roles section with no roles configured
 */
export const NoRoles: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    served({ ...catalog, roles: [] });
  },
  play: async ({ canvasElement }) => {
    const roles = section(canvasElement, /^Model roles$/);

    await expect(roles.getByText("No roles configured.")).toBeVisible();
  },
};

/**
 * Models are grouped by the provider segment of their id, each row marked
 * Default when new chats use it and with the step it holds in each role.
 *
 * @summary models grouped by provider with default and role-step marks
 */
export const Directory: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const models = section(canvasElement, /^Models \(3\)$/);

    await expect(models.getByText("opencode-go · 2")).toBeVisible();
    await expect(models.getByText("codex · 1")).toBeVisible();

    const deepseekRow = models.getByRole("button", {
      name: "DeepSeek V4.1 Flash (Go) details",
    });

    await expect(deepseekRow).toHaveTextContent("Default");
    await expect(deepseekRow).toHaveTextContent("@small · 2");

    const lunaRow = models.getByRole("button", { name: "GPT-6 Luna details" });

    await expect(lunaRow).toHaveTextContent("@small · 3");
    await expect(lunaRow).not.toHaveTextContent("Default");
  },
};

/**
 * The search filters by name, id or description; a search that matches
 * nothing says so.
 *
 * @summary searching the model directory
 */
export const Search: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const models = section(canvasElement, /^Models \(3\)$/);
    const search = models.getByRole("textbox", { name: "Search models" });

    await userEvent.type(search, "luna");
    await expect(
      models.getByRole("button", { name: "GPT-6 Luna details" }),
    ).toBeVisible();
    await expect(
      models.queryByRole("button", { name: "Hy4 Flash (Go) details" }),
    ).toBeNull();
    await expect(models.queryByText("opencode-go · 2")).toBeNull();

    await userEvent.clear(search);
    await userEvent.type(search, "nothing-like-this");
    await expect(models.getByText("No models match.")).toBeVisible();
  },
};

/**
 * Opening a row shows the details the composer's preview card shows, plus
 * inputs and effort levels: context, prices, dates, the id and the links.
 *
 * @summary a model row opened to its details
 */
export const RowOpened: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const models = section(canvasElement, /^Models \(3\)$/);

    await userEvent.click(
      models.getByRole("button", { name: "DeepSeek V4.1 Flash (Go) details" }),
    );

    await expect(await models.findByText("1,000,000 tokens")).toBeVisible();
    await expect(models.getByText("$0.14 / 1M tokens")).toBeVisible();
    await expect(models.getByText("$0.28 / 1M tokens")).toBeVisible();
    await expect(models.getByText("text")).toBeVisible();
    await expect(models.getByText("low · medium · high")).toBeVisible();
    await expect(models.getByText("March 1, 2026")).toBeVisible();
    await expect(models.getByRole("link", { name: /API Docs/ })).toBeVisible();
  },
};
