"use client";

import type { ReactElement } from "react";
import { z } from "zod";

import { formatInstant } from "@workspace/ui/components/custom/search-conversations";
import {
  parseNumberedLines,
  SourceLines,
} from "@workspace/ui/components/custom/source-lines";
import {
  ToolDetails,
  type ToolPartProps,
  ToolResultFallback,
  ToolRow,
  ToolSection,
} from "@workspace/ui/components/custom/tool-row";

const inputSchema = z.object({
  chatId: z.string(),
  messageSeq: z.number(),
});

/** Loose: the runner's oversize cap may add `truncationNotice`. */
const outputSchema = z.looseObject({
  status: z.literal("success"),
  role: z.string(),
  timestamp: z.string(),
  content: z.string(),
  notice: z.string(),
  previousMessageSeq: z.number().optional(),
  nextMessageSeq: z.number().optional(),
  nextOffset: z.number().optional(),
  cutReason: z.enum(["line_limit", "output_limit"]).optional(),
  truncationNotice: z.string().optional(),
});

type ConversationReadOutput = z.infer<typeof outputSchema>;

/** Props for the dedicated `conversation_read` tool row. */
export type ConversationReadToolProps = ToolPartProps;

const cutReasons = {
  line_limit: "line limit",
  output_limit: "output limit",
} as const;

function ConversationMessage({ output }: { output: ConversationReadOutput }) {
  const lines = parseNumberedLines(output.content);
  return (
    <>
      <ToolSection
        label={`${output.role} message`}
        aside={formatInstant(output.timestamp)}
      >
        {lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">No text.</p>
        ) : (
          <SourceLines lines={lines} label="Message lines" />
        )}
      </ToolSection>
      <ToolDetails
        rows={[
          [
            "Continues",
            output.nextOffset === undefined
              ? undefined
              : `at line ${output.nextOffset + 1}${output.cutReason ? ` (${cutReasons[output.cutReason]})` : ""}`,
          ],
          ["Previous message", output.previousMessageSeq?.toString()],
          ["Next message", output.nextMessageSeq?.toString()],
          ["Note", output.truncationNotice],
          ["Notice", output.notice],
        ]}
      />
    </>
  );
}

/**
 * Renders a `conversation_read` invocation: the role and time of the past
 * message that was read, its lines with their numbers, and where the read
 * continues when the message is longer than one page.
 *
 * @summary displays a read of a past conversation message inside a collapsible tool row
 */
export function ConversationReadTool({
  input,
  output,
  errorText,
  state,
}: ConversationReadToolProps): ReactElement {
  const source = inputSchema.safeParse(input).data;
  const result = outputSchema.safeParse(output).data;
  return (
    <ToolRow
      name="conversation_read"
      summary={source && `${source.chatId.slice(0, 8)} #${source.messageSeq}`}
      input={input}
      errorText={errorText}
      state={state}
    >
      {result ? (
        <ConversationMessage output={result} />
      ) : (
        <ToolResultFallback output={output} pendingLabel="Reading…" />
      )}
    </ToolRow>
  );
}
