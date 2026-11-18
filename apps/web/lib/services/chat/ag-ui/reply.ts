import { EventType, type AGUIEvent } from "@ag-ui/core";
import type { DynamicToolUIPart, JSONValue, UIMessage } from "ai";
import { z } from "zod";

/**
 * AG-UI events → the reply of one Run segment.
 *
 * The api writes a reply's ordered parts as AG-UI events (see
 * `apps/api/src/runs/ag-ui-events.ts`); this is the inverse. AG-UI messages are
 * flat — each text part and each reasoning part is a message of its own — so
 * the reply is every event of the run, in arrival order, as the same parts the
 * stored transcript holds. A live reply and its reloaded copy therefore render
 * through one model.
 */

type Part = UIMessage["parts"][number];

/** `CUSTOM` event names of the stream, and the data part each notice becomes. */
const MESSAGE_METADATA_EVENT = "llame.message-metadata";

const NOTICE_PART_TYPE = new Map<string, `data-${string}`>([
  ["llame.cap-notice", "data-cap-notice"],
  ["llame.compaction-failed", "data-compaction-failed"],
  ["llame.compaction-disabled", "data-compaction-disabled"],
  ["llame.model-retrying", "data-model-retrying"],
  ["llame.run-delivered", "data-run-delivered"],
]);

/** The failure a `TOOL_CALL_RESULT` carries under `metadata.llame`. */
const toolFailureSchema = z.object({
  llame: z.object({
    error: z.literal(true),
    cancelled: z.literal(true).optional(),
    interrupted: z.literal(true).optional(),
  }),
});

const toolIntentSchema = z.object({ llame: z.object({ intent: z.string() }) });
const storedIntentSchema = z.object({ intent: z.string().optional() });

/** Reply metadata is the api's own object; today it holds the turn's usage. */
const replyMetadataSchema = z.looseObject({});

const jsonSchema = z.json();
const supersededSchema = z.object({ messageIds: z.array(z.string()) });

type ReplyMetadata = z.infer<typeof replyMetadataSchema>;

/** What one Run segment's stream has produced so far. */
export type Reply = {
  /** The Run the stream carries, once `RUN_STARTED` named it. */
  runId: string | null;
  parts: Array<Part>;
  metadata: ReplyMetadata | undefined;
  /** True once `RUN_FINISHED` arrived: the only sign the segment ended. */
  finished: boolean;
  /** The server settled this Run as cancelled, rather than successfully. */
  cancelled: boolean;
  /** The Run's own failure, from `RUN_ERROR`. */
  errorText: string | null;
};

type ToolCallEvent = Extract<
  AGUIEvent,
  {
    type:
      | EventType.TOOL_CALL_START
      | EventType.TOOL_CALL_ARGS
      | EventType.TOOL_CALL_END;
  }
>;

type ToolResultEvent = Extract<AGUIEvent, { type: EventType.TOOL_CALL_RESULT }>;

/** Tool arguments and outputs are JSON text; anything else is the text. */
function jsonOrText(text: string): JSONValue {
  try {
    return jsonSchema.parse(JSON.parse(text));
  } catch {
    return text;
  }
}

/** The settled part of a failed call, with why it ended when the api said. */
function failedToolPart(
  held: DynamicToolUIPart,
  errorText: string,
  failure: z.infer<typeof toolFailureSchema>["llame"],
): DynamicToolUIPart {
  const { cancelled, interrupted } = failure;

  return {
    type: "dynamic-tool",
    toolCallId: held.toolCallId,
    toolName: held.toolName,
    ...storedIntentSchema.parse(held),
    state: "output-error",
    input: held.input,
    errorText,
    ...((cancelled === true || interrupted === true) && {
      resultProviderMetadata: {
        llame: {
          ...(cancelled === true && { cancelled }),
          ...(interrupted === true && { interrupted }),
        },
      },
    }),
  };
}

/**
 * The reducer of one stream. Parts are replaced, never mutated, so a snapshot
 * a renderer holds stays as it was.
 */
export class ReplyReducer {
  private state: Reply = {
    runId: null,
    parts: [],
    metadata: undefined,
    finished: false,
    cancelled: false,
    errorText: null,
  };

  // Retain closed message identities until a supersession can remove them.
  private readonly messageIndex = new Map<string, number>();
  private readonly toolIndex = new Map<string, number>();
  private readonly toolArguments = new Map<string, string>();

  reply(): Reply {
    return this.state;
  }

  /** Applies one event; false when it changed nothing a reader can see. */
  apply(event: AGUIEvent): boolean {
    switch (event.type) {
      case EventType.RUN_STARTED:
        return this.set({ runId: event.runId });
      case EventType.TEXT_MESSAGE_START:
        return this.open(event.messageId, "text");
      case EventType.REASONING_MESSAGE_START:
        return this.open(event.messageId, "reasoning");
      case EventType.TEXT_MESSAGE_CONTENT:
      case EventType.REASONING_MESSAGE_CONTENT:
        return this.write(event.messageId, event.delta);
      case EventType.TEXT_MESSAGE_END:
      case EventType.REASONING_MESSAGE_END:
        return this.close(event.messageId);
      case EventType.TOOL_CALL_START:
      case EventType.TOOL_CALL_ARGS:
      case EventType.TOOL_CALL_END:
        return this.applyToolCall(event);
      case EventType.TOOL_CALL_RESULT:
        return this.settleTool(event);
      case EventType.CUSTOM:
        return this.applyCustom(event);
      case EventType.RUN_FINISHED:
        return this.set({
          finished: true,
          cancelled: event.outcome?.type === "cancelled",
        });
      case EventType.RUN_ERROR:
        return this.set({ errorText: event.message });
      default:
        return false;
    }
  }

  private set(change: Partial<Reply>): true {
    this.state = { ...this.state, ...change };

    return true;
  }

  private push(part: Part): number {
    this.set({ parts: [...this.state.parts, part] });

    return this.state.parts.length - 1;
  }

  private replace(index: number, part: Part): true {
    return this.set({
      parts: this.state.parts.map((held, at) => (at === index ? part : held)),
    });
  }

  private open(messageId: string, type: "text" | "reasoning"): true {
    this.messageIndex.set(
      messageId,
      this.push({ type, text: "", state: "streaming" }),
    );

    return true;
  }

  /** The open text or reasoning part of a message, with where it sits. */
  private openPart(messageId: string) {
    const index = this.messageIndex.get(messageId);
    const part = index === undefined ? undefined : this.state.parts[index];

    return index !== undefined &&
      (part?.type === "text" || part?.type === "reasoning") &&
      part.state === "streaming"
      ? { index, part }
      : null;
  }

  private write(messageId: string, delta: string): boolean {
    const held = this.openPart(messageId);

    return (
      held !== null &&
      this.replace(held.index, { ...held.part, text: held.part.text + delta })
    );
  }

  private close(messageId: string): boolean {
    const held = this.openPart(messageId);

    if (held === null) return false;

    return this.replace(held.index, { ...held.part, state: "done" });
  }

  private toolPart(toolCallId: string) {
    const index = this.toolIndex.get(toolCallId);
    const part = index === undefined ? undefined : this.state.parts[index];

    return index !== undefined && part?.type === "dynamic-tool"
      ? { index, part }
      : null;
  }

  private applyToolCall(event: ToolCallEvent): boolean {
    const { toolCallId } = event;

    if (event.type === EventType.TOOL_CALL_START) {
      return this.startTool(event);
    }

    const written = this.toolArguments.get(toolCallId) ?? "";

    if (event.type === EventType.TOOL_CALL_ARGS) {
      this.toolArguments.set(toolCallId, written + event.delta);

      return false;
    }

    const held = this.toolPart(toolCallId);

    if (held === null) return false;
    this.toolArguments.delete(toolCallId);

    return this.replace(held.index, {
      type: "dynamic-tool",
      toolCallId,
      toolName: held.part.toolName,
      ...storedIntentSchema.parse(held.part),
      state: "input-available",
      input: jsonOrText(written),
    });
  }

  private startTool(
    event: Extract<AGUIEvent, { type: EventType.TOOL_CALL_START }>,
  ): true {
    const { toolCallId, toolCallName: toolName } = event;

    const intent = toolIntentSchema.safeParse(event.metadata).data?.llame
      .intent;

    this.toolArguments.set(toolCallId, "");
    this.toolIndex.set(
      toolCallId,
      this.push({
        type: "dynamic-tool",
        toolCallId,
        toolName,
        state: "input-streaming",
        input: undefined,
        ...(intent !== undefined && { intent }),
      }),
    );

    return true;
  }

  private settleTool(event: ToolResultEvent): boolean {
    const held = this.toolPart(event.toolCallId);

    if (held === null) return false;
    const failure = toolFailureSchema.safeParse(event.metadata);

    const content = Array.isArray(event.content)
      ? JSON.stringify(event.content)
      : event.content;

    if (failure.success) {
      return this.replace(
        held.index,
        failedToolPart(held.part, content, failure.data.llame),
      );
    }

    return this.replace(held.index, {
      type: "dynamic-tool",
      toolCallId: held.part.toolCallId,
      toolName: held.part.toolName,
      ...storedIntentSchema.parse(held.part),
      state: "output-available",
      input: held.part.input,
      output: jsonOrText(content),
    });
  }

  private supersede(messageIds: Array<string>): boolean {
    const removed = new Set<number>();

    for (const id of messageIds) {
      const index = this.messageIndex.get(id);

      if (index !== undefined) removed.add(index);
    }

    if (removed.size === 0) return false;
    const positions = new Map<number, number>();
    const parts = this.state.parts.filter((_part, index) => {
      if (removed.has(index)) return false;
      positions.set(index, positions.size);

      return true;
    });

    for (const indices of [this.messageIndex, this.toolIndex]) {
      for (const [id, index] of indices) {
        const position = positions.get(index);

        if (position === undefined) indices.delete(id);
        else indices.set(id, position);
      }
    }

    return this.set({ parts });
  }

  private applyCustom(
    event: Extract<AGUIEvent, { type: EventType.CUSTOM }>,
  ): boolean {
    if (event.name === MESSAGE_METADATA_EVENT) {
      const metadata = replyMetadataSchema.safeParse(event.value);

      return (
        metadata.success &&
        this.set({ metadata: { ...this.state.metadata, ...metadata.data } })
      );
    }

    if (event.name === "llame.model-superseded") {
      const parsed = supersededSchema.safeParse(event.value);

      return parsed.success && this.supersede(parsed.data.messageIds);
    }

    const type = NOTICE_PART_TYPE.get(event.name);

    if (type === undefined) return false;
    this.push({ type, data: jsonSchema.parse(event.value) });

    return true;
  }
}
