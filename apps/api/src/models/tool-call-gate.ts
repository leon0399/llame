import { NoSuchToolError, type streamText, type ToolSet } from 'ai';
import { isString } from '@workspace/runtime-safety';

import type { ModelStreamInput } from './model-client';

/**
 * Orders a step's tool work behind the reasoning the provider streamed before
 * the call (#1184). Reasoning reaches the run through an independent
 * `fullStream` consumer, and how far that consumer has drained when the SDK
 * executes or refuses a call depends on the runtime's stream scheduling. The
 * consumer reports each `tool-call` part it reaches; `fullStream` is ordered,
 * so by then every earlier reasoning delta has been delivered.
 *
 * Unattached — no in-order consumer for this request — the gate passes every
 * call straight through.
 */
export type ToolCallGate = {
  /** Marks that an in-order consumer will report this request's calls. */
  attach(): void;
  /** The consumer reached this call's `tool-call` part. */
  reach(toolCallId: string): void;
  /** The consumer ended; nothing it has not reached can be waited on. */
  close(): void;
  /** Resolves once the consumer has reached the call. */
  reached(toolCallId: string): Promise<void>;
  /** Runs `task` synchronously when the consumer reaches the call. */
  whenReached(toolCallId: string, task: () => void): void;
};

export function createToolCallGate(): ToolCallGate {
  let attached = false;
  let closed = false;
  const reachedIds = new Set<string>();
  const pending = new Map<string, Array<() => void>>();
  const settle = (toolCallId: string): void => {
    const tasks = pending.get(toolCallId) ?? [];
    pending.delete(toolCallId);
    for (const task of tasks) task();
  };
  const whenReached = (toolCallId: string, task: () => void): void => {
    if (!attached || closed || reachedIds.has(toolCallId)) {
      task();
      return;
    }
    pending.set(toolCallId, [...(pending.get(toolCallId) ?? []), task]);
  };
  return {
    attach: () => {
      attached = true;
    },
    reach: (toolCallId) => {
      reachedIds.add(toolCallId);
      settle(toolCallId);
    },
    close: () => {
      closed = true;
      for (const toolCallId of pending.keys()) settle(toolCallId);
    },
    // The api lib target predates `Promise.withResolvers`.
    reached: (toolCallId) =>
      new Promise((resolve) => whenReached(toolCallId, resolve)),
    whenReached,
  };
}

/**
 * The tool record with every `execute` held behind the gate. A proxy rather
 * than a copy: the run adds tools to the record it is handed after the request
 * starts (`AttemptToolAdditions`), and the SDK looks each tool up by name when
 * a call arrives, so later additions are gated too.
 */
export function gateToolExecution(tools: ToolSet, gate: ToolCallGate): ToolSet {
  const gated = new WeakMap<object, ToolSet[string]>();
  return new Proxy(tools, {
    get(target, key) {
      // A tool record is keyed by tool name; it carries no symbol members.
      if (!isString(key)) return undefined;
      const definition = target[key];
      if (!isExecutableTool(definition)) return definition;
      const existing = gated.get(definition);
      if (existing !== undefined) return existing;
      const execute = definition.execute;
      const wrapped: ToolSet[string] = {
        ...definition,
        execute: async (input, options) => {
          await gate.reached(options.toolCallId);
          const output: unknown = await execute(input, options);
          return output;
        },
      };
      gated.set(definition, wrapped);
      return wrapped;
    },
  });
}

/** Best-effort parse of a tool call's raw stringified-JSON `input`
 *  (`LanguageModelV3ToolCall.input` is always a string at the provider
 *  layer). Falls back to the raw string when it isn't valid JSON, rather than
 *  throwing — a hallucinating model's malformed arguments are still a
 *  recorded observation, not a crash. */
function parseToolCallInput(raw: string) {
  try {
    // SAFETY: JSON.parse returns any; asserting unknown forces the caller to
    // narrow before use (the catch below is this function's own fallback).
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * The SDK's repair hook, recording a tool call the model requested but that
 * never passed the gate: an undeclared/hallucinated name, or arguments the
 * tool's own schema rejects. Returning `null` lets the SDK synthesize the
 * model-visible tool error, so the run never crashes. The SDK calls this
 * before the call's part is in `fullStream`, so the report waits for the
 * reasoning consumer to reach that part rather than blocking the repair.
 */
export function refuseUnavailableToolCalls(
  report: ModelStreamInput['onUnavailableToolCall'],
  gate: ToolCallGate,
): NonNullable<
  Parameters<typeof streamText>[0]['experimental_repairToolCall']
> {
  return ({ toolCall, error }) => {
    gate.whenReached(toolCall.toolCallId, () =>
      report?.({
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: parseToolCallInput(toolCall.input),
        reason: NoSuchToolError.isInstance(error)
          ? 'not_available'
          : 'invalid_input',
      }),
    );
    return Promise.resolve(null);
  };
}

function isExecutableTool(value: unknown): value is ToolSet[string] & {
  execute: NonNullable<ToolSet[string]['execute']>;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'execute' in value &&
    typeof value.execute === 'function'
  );
}
