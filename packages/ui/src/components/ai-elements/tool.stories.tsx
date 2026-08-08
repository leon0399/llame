import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ToolUIPart } from "ai";
import { expect } from "storybook/test";

import { contrastKnownIssue232 } from "../known-a11y-issues.js";
import { CodeBlock } from "./code-block.js";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "./tool.js";

// Tool is Vercel AI Elements' component (vendored; Shiki-backed JSON
// rendering via ./code-block.js), not a shadcn primitive. Four of the five
// stories below are transcribed from its own docs examples
// (https://elements.ai-sdk.dev/components/tool#examples, source
// `packages/examples/src/tool-<state>.tsx` in github.com/vercel/ai-elements),
// so they carry the "ai-elements-example" provenance tag alongside
// "ai-generated" — the AI Elements analog of our shadcn "shadcn-example" tag.
// Adapted only for import paths, dropping each example's `nanoid()` call (an
// unrelated dependency we don't declare here; replaced with a static
// `toolCallId` — the id isn't rendered) and its outer
// `<div style={{ height: "500px" }}>` preview-container sizing. `defaultOpen`
// and the `play` assertions are our own overlay, same as a shadcn-example's
// interaction test. `NoInputYet` has no docs example — it documents this
// fork's undefined-input guard (see tool.tsx's `ToolInput`) — so it carries
// only "ai-generated".
const meta = {
  component: Tool,
  subcomponents: { ToolHeader, ToolContent, ToolInput, ToolOutput },
  // Cropped to a fixed chat-column width (unlike its full-width ai-elements
  // siblings): a tool-call card is a discrete unit best shown at the width it
  // occupies inside an assistant message, not stretched across the canvas.
  // `layout: "centered"` makes `#storybook-root` shrink-wrap to the decorator
  // so the visual capture crops tight (see packages/ui/CLAUDE.md), instead of
  // the full-width block a `layout: "padded"` root leaves for the content-clip.
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[36rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Tool>;

export default meta;

type Story = StoryObj<typeof meta>;

const webSearchCall = {
  errorText: undefined,
  input: {
    include_snippets: true,
    max_results: 10,
    query: "latest AI market trends 2024",
  },
  output: undefined,
  state: "input-streaming" as const,
  toolCallId: "web_search_1",
  type: "tool-web_search" as const,
};

/**
 * Use the pending state while the model is still streaming the tool call's
 * arguments — the badge reads "Pending" even though (as here) partial
 * arguments may already be visible.
 *
 * Adapted from [AI Elements Tool › Input Streaming (Pending)](https://elements.ai-sdk.dev/components/tool#input-streaming-pending).
 *
 * @summary for a tool call whose input is still streaming in
 */
export const Pending: Story = {
  tags: ["ai-elements-example", "ai-generated"],
  render: () => (
    <Tool defaultOpen>
      <ToolHeader state={webSearchCall.state} type={webSearchCall.type} />
      <ToolContent>
        <ToolInput input={webSearchCall.input} />
      </ToolContent>
    </Tool>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Pending")).toBeInTheDocument();
    await expect(canvas.getByText("Parameters")).toBeInTheDocument();
  },
};

/**
 * Use `ToolInput` with `input={undefined}` for the moment a tool call has
 * been registered but no arguments have streamed in yet — it renders nothing
 * rather than an empty "Parameters" panel, and (per `tool.tsx`) avoids
 * passing `undefined` into `safeStringify`/Shiki.
 *
 * @summary for input-streaming before any arguments have arrived
 */
export const NoInputYet: Story = {
  tags: ["ai-generated"],
  render: () => (
    <Tool defaultOpen>
      <ToolHeader type="tool-web_search" state="input-streaming" />
      <ToolContent>
        <ToolInput input={undefined} />
      </ToolContent>
    </Tool>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Pending")).toBeInTheDocument();
    await expect(canvas.queryByText("Parameters")).not.toBeInTheDocument();
  },
};

const imageGenerationCall = {
  errorText: undefined,
  input: {
    prompt: "A futuristic cityscape at sunset with flying cars",
    quality: "high",
    resolution: "1024x1024",
    style: "digital_art",
  },
  output: undefined,
  state: "input-available" as const,
  toolCallId: "image_generation_1",
  type: "tool-image_generation" as const,
};

/**
 * Use the running state once the model has finished streaming arguments and
 * the tool is executing — `ToolInput` renders the call's parameters while no
 * result exists yet.
 *
 * Adapted from [AI Elements Tool › Input Available (Running)](https://elements.ai-sdk.dev/components/tool#input-available-running).
 *
 * @summary for a tool call that is currently executing
 */
export const Running: Story = {
  tags: ["ai-elements-example", "ai-generated"],
  render: () => (
    <Tool defaultOpen>
      <ToolHeader
        state={imageGenerationCall.state}
        type={imageGenerationCall.type}
      />
      <ToolContent>
        <ToolInput input={imageGenerationCall.input} />
      </ToolContent>
    </Tool>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Running")).toBeInTheDocument();
    await expect(canvas.getByText("Parameters")).toBeInTheDocument();
    await expect(canvas.queryByText("Result")).not.toBeInTheDocument();
  },
};

const cancelledCall: ToolUIPart = {
  errorText: "The run was cancelled before this tool finished.",
  input: { query: "latest AI market trends 2024" },
  output: undefined,
  state: "output-error",
  toolCallId: "cancelled_1",
  type: "tool-search_conversations",
};

/**
 * Use the cancelled state when the run was terminated by the user while this
 * tool was still executing. The badge reads "Cancelled" with neutral styling
 * (muted, not red) so a user who cancelled their own run is not told something
 * failed.
 *
 * This state has no SDK counterpart — `ToolUIPart["state"]` has no cancelled
 * value, and the bridge maps every structured error to `output-error`.
 * `ToolHeaderState` widens the SDK's union with `"cancelled"`, and the chat
 * page maps it from the structured `cancelled` field on the persisted part.
 *
 * @summary for a tool call that was terminated by the user
 */
export const Cancelled: Story = {
  tags: ["ai-generated"],
  render: () => (
    <Tool defaultOpen>
      <ToolHeader state="cancelled" type={cancelledCall.type} />
      <ToolContent>
        <ToolInput input={cancelledCall.input} />
        {cancelledCall.state === "output-error" && (
          <ToolOutput
            errorText={cancelledCall.errorText}
            output={cancelledCall.output}
          />
        )}
      </ToolContent>
    </Tool>
  ),
  parameters: contrastKnownIssue232,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Cancelled")).toBeInTheDocument();
    await expect(
      canvas.getByText("The run was cancelled before this tool finished."),
    ).toBeInTheDocument();
    // The badge says "Cancelled", not "Error" — that is the distinction this
    // story exists to verify. The output panel heading still says "Error"
    // (ToolOutput renders errorText under that label), which is correct:
    // state="cancelled" overrides the badge, not the result panel.
    const badges = canvas.getAllByText("Cancelled");
    await expect(badges.length).toBeGreaterThanOrEqual(1);
  },
};

const databaseQueryCall: ToolUIPart = {
  errorText: undefined,
  input: {
    database: "analytics",
    params: ["2024-01-01"],
    query: "SELECT COUNT(*) FROM users WHERE created_at >= ?",
  },
  output: [
    {
      "Created At": "2024-01-15",
      Email: "john@example.com",
      Name: "John Doe",
      "User ID": 1,
    },
    {
      "Created At": "2024-01-20",
      Email: "jane@example.com",
      Name: "Jane Smith",
      "User ID": 2,
    },
    {
      "Created At": "2024-02-01",
      Email: "bob@example.com",
      Name: "Bob Wilson",
      "User ID": 3,
    },
    {
      "Created At": "2024-02-10",
      Email: "alice@example.com",
      Name: "Alice Brown",
      "User ID": 4,
    },
    {
      "Created At": "2024-02-15",
      Email: "charlie@example.com",
      Name: "Charlie Davis",
      "User ID": 5,
    },
  ],
  state: "output-available",
  toolCallId: "database_query_1",
  type: "tool-database_query",
};

/**
 * Use the completed state once the tool has returned a result — here the
 * output is a JSON value, so it's wrapped in a `CodeBlock` and passed to
 * `ToolOutput` as a pre-rendered element.
 *
 * Adapted from [AI Elements Tool › Output Available (Completed)](https://elements.ai-sdk.dev/components/tool#output-available-completed).
 *
 * @summary for a tool call that finished successfully
 */
export const Completed: Story = {
  tags: ["ai-elements-example", "ai-generated"],
  render: () => (
    <Tool defaultOpen>
      <ToolHeader
        state={databaseQueryCall.state}
        type={databaseQueryCall.type}
      />
      <ToolContent>
        <ToolInput input={databaseQueryCall.input} />
        {databaseQueryCall.state === "output-available" && (
          <ToolOutput
            errorText={databaseQueryCall.errorText}
            output={
              <CodeBlock
                code={JSON.stringify(databaseQueryCall.output)}
                language="json"
              />
            }
          />
        )}
      </ToolContent>
    </Tool>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Completed")).toBeInTheDocument();
    await expect(canvas.getByText("Result")).toBeInTheDocument();
  },
};

const apiRequestCall: ToolUIPart = {
  errorText:
    "Connection timeout: The request took longer than 5000ms to complete. Please check your network connection and try again.",
  input: {
    headers: {
      Authorization: "Bearer <YOUR_TOKEN_HERE>",
      "Content-Type": "application/json",
    },
    method: "GET",
    timeout: 5000,
    url: "https://api.example.com/data",
  },
  output: undefined,
  state: "output-error",
  toolCallId: "api_request_1",
  type: "tool-api_request",
};

/**
 * Use the error state when the tool call failed — `ToolOutput` renders
 * `errorText` in a destructive panel instead of a result, and the original
 * parameters stay visible for context.
 *
 * Adapted from [AI Elements Tool › Output Error](https://elements.ai-sdk.dev/components/tool#output-error).
 *
 * @summary for a tool call that failed
 */
export const Failed: Story = {
  tags: ["ai-elements-example", "ai-generated"],
  // #232 — the vendored error panel renders `text-destructive` on a
  // `bg-destructive/10` tint (~4:1), below WCAG AA. Suppress only color-contrast
  // until the destructive token contrast is fixed.
  parameters: contrastKnownIssue232,
  render: () => (
    <Tool defaultOpen>
      <ToolHeader state={apiRequestCall.state} type={apiRequestCall.type} />
      <ToolContent>
        <ToolInput input={apiRequestCall.input} />
        {apiRequestCall.state === "output-error" && (
          <ToolOutput
            errorText={apiRequestCall.errorText}
            output={apiRequestCall.output}
          />
        )}
      </ToolContent>
    </Tool>
  ),
  play: async ({ canvas }) => {
    // "Error" appears twice — the status badge and the output panel heading.
    await expect(canvas.getAllByText("Error").length).toBeGreaterThan(0);
    await expect(
      canvas.getByText(
        "Connection timeout: The request took longer than 5000ms to complete. Please check your network connection and try again.",
      ),
    ).toBeInTheDocument();
  },
};
