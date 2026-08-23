import {
  tool as createSdkTool,
  type FinishReason,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
} from "ai";

import { type ApprovalGate } from "./approval";
import { type ModelStreamInput } from "./models/model-client";
import { toFlexibleSchema } from "./tools/schema-utils";
import { runTool } from "./tools/tool-runner";
import {
  type BaseToolContext,
  type Tool,
  type ToolResult,
} from "./tools/types";
import { type UnknownRecord } from "./unknown-record";

/** The loosest tool shape the loop advertises; concrete hosts pass their own. */
export type LoopTool = Tool<UnknownRecord, BaseToolContext>;

/**
 * The narrow client surface the run loop consumes. The extracted
 * `ModelClient` satisfies it structurally; test fakes implement it directly
 * without touching the AI SDK.
 */
export interface RunModelClient {
  readonly model: string;
  readonly provider: string;
  // PromiseLike: the AI SDK's StreamTextResult exposes these as
  // PromiseLike, and the loop only awaits them.
  streamText(input: ModelStreamInput): {
    readonly text: PromiseLike<string>;
    readonly usage: PromiseLike<LanguageModelUsage>;
    readonly finishReason: PromiseLike<FinishReason>;
    readonly response: PromiseLike<{ messages: ModelMessage[] }>;
  };
}

/**
 * The immutable record of the context one run executed against: the model it
 * ran as, the effective prompt, and the advertised tool contract. Bound at
 * run start and emitted as the first run event, so "what did the assistant
 * see on that turn" has a durable answer (VISION.md: context changes are
 * narrated, not silent).
 */
export interface ContextReceipt {
  readonly provider: string;
  readonly model: string;
  readonly systemPrompt: string;
  readonly advertisedTools: readonly string[];
  readonly maxSteps: number;
}

/**
 * In-band narration of everything the harness does to the model's execution.
 * One mechanism serving two audiences: these events are what the owner (and
 * the session log) inspect; nothing about the run changes silently.
 */
export type RunEvent =
  | { type: "run_started"; receipt: ContextReceipt }
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | {
      type: "tool_started";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | {
      type: "tool_completed";
      toolCallId: string;
      toolName: string;
      result: ToolResult;
    }
  | {
      type: "tool_unavailable";
      toolCallId: string;
      toolName: string;
      input: unknown;
      reason: "not_available" | "invalid_input";
    }
  | { type: "step_cap_reached" }
  | { type: "run_finished"; text: string };

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_CALL_TIMEOUT_SECONDS = 60;

export interface ExecuteRunInput {
  client: RunModelClient;
  /** Effective system prompt; bound verbatim into the receipt. */
  system: string;
  /** Model context so far (projected from the session log by the caller). */
  messages: ModelMessage[];
  registry: ReadonlyMap<string, LoopTool>;
  /** Required before any non-read-only tool executes; absent denies. */
  approvalGate?: ApprovalGate;
  maxSteps?: number;
  callTimeoutSeconds?: number;
  abortSignal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
}

export interface RunOutcome {
  receipt: ContextReceipt;
  text: string;
  usage: LanguageModelUsage;
  finishReason: FinishReason;
  /** Assistant-side messages to append to the session log. */
  responseMessages: ModelMessage[];
}

/**
 * Execute one agentic turn: bind the context receipt, advertise the
 * registry's tools through permission-safe wrappers, and let the AI SDK
 * drive the tool-calling loop to a final answer. The harness owns execution
 * — the model proposes tool calls; validation, approval, timeouts, and
 * recording happen here.
 */
export async function executeRun(input: ExecuteRunInput): Promise<RunOutcome> {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const callTimeoutSeconds =
    input.callTimeoutSeconds ?? DEFAULT_CALL_TIMEOUT_SECONDS;
  const onEvent = input.onEvent ?? (() => {});

  const receipt: ContextReceipt = {
    provider: input.client.provider,
    model: input.client.model,
    systemPrompt: input.system,
    advertisedTools: [...input.registry.keys()],
    maxSteps,
  };
  onEvent({ type: "run_started", receipt });

  const toolSet: ToolSet = Object.fromEntries(
    [...input.registry.values()].flatMap((entry) => {
      const inputSchema = toFlexibleSchema(entry.inputSchema);
      // An uncompilable schema means the tool must remain unavailable rather
      // than run unvalidated — omit it from the advertised contract.
      if (!inputSchema) return [];
      return [
        [
          entry.id,
          createSdkTool({
            description: entry.description,
            inputSchema,
            execute: async (
              // eslint-disable-next-line anti-slop/no-unknown-parameters -- mirrors the AI SDK's own `tool({ execute })` callback signature; `args` is validated against the tool's declared `inputSchema` (`toFlexibleSchema` above) by the SDK itself before this executor is invoked, and `runTool` re-validates at its own boundary -- the parse happens one frame down, not here.
              args: unknown,
              { toolCallId }: { toolCallId: string },
            ) => {
              onEvent({
                type: "tool_started",
                toolCallId,
                toolName: entry.id,
                input: args,
              });
              const result = await runTool(
                entry,
                args,
                { toolCallId },
                callTimeoutSeconds,
                undefined,
                input.approvalGate,
              );
              onEvent({
                type: "tool_completed",
                toolCallId,
                toolName: entry.id,
                result,
              });
              return result;
            },
          }),
        ] as const,
      ];
    }),
  );

  const result = input.client.streamText({
    messages: input.messages,
    system: input.system,
    abortSignal: input.abortSignal,
    ...(Object.keys(toolSet).length > 0 && { tools: toolSet }),
    maxSteps,
    onCapReached: () => onEvent({ type: "step_cap_reached" }),
    onUnavailableToolCall: (event) =>
      onEvent({ type: "tool_unavailable", ...event }),
    onTextDelta: (text) => onEvent({ type: "text_delta", text }),
    onReasoningDelta: (text) => onEvent({ type: "reasoning_delta", text }),
  });

  const text = await result.text;
  const [usage, finishReason, response] = await Promise.all([
    result.usage,
    result.finishReason,
    result.response,
  ]);
  onEvent({ type: "run_finished", text });

  return {
    receipt,
    text,
    usage,
    finishReason,
    responseMessages: response.messages,
  };
}
