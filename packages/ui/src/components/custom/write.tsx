"use client";

import type { ReactElement } from "react";
import { z } from "zod";

import {
  languageForPath,
  numberLines,
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
  path: z.string(),
  content: z.string(),
  replace: z.boolean().optional(),
});

/** Loose: the runner's oversize cap may add `truncationNotice`. */
const outputSchema = z.looseObject({
  status: z.literal("success"),
  created: z.literal(true).optional(),
  replaced: z.literal(true).optional(),
  truncationNotice: z.string().optional(),
});

type WriteInput = z.infer<typeof inputSchema>;

/** Props for the dedicated `write` tool row. */
export type WriteToolProps = ToolPartProps;

/** The submitted content, numbered from line 1. It is the whole file, while
 *  the result echoes at most its first 2,000 lines. */
function WriteContent({ input }: { input: WriteInput }) {
  const lines = numberLines(input.content);
  return (
    <ToolSection
      label={input.replace ? "Replace contents" : "New file"}
      aside={`${lines.length} ${lines.length === 1 ? "line" : "lines"}`}
    >
      {lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">Empty file.</p>
      ) : (
        <SourceLines
          lines={lines}
          label="Written content"
          language={languageForPath(input.path)}
        />
      )}
    </ToolSection>
  );
}

/**
 * Renders a native `write` invocation: the content written with its line
 * numbers (shown while the write runs and after a failure), then whether the
 * file was created or replaced.
 *
 * @summary displays a whole-file write inside a collapsible tool row
 */
export function WriteTool({
  input,
  output,
  errorText,
  state,
}: WriteToolProps): ReactElement {
  const write = inputSchema.safeParse(input).data;
  const result = outputSchema.safeParse(output).data;
  return (
    <ToolRow
      name="write"
      summary={write?.path}
      input={input}
      errorText={errorText}
      state={state}
      showInput={write === undefined}
      preview={write ? <WriteContent input={write} /> : null}
    >
      {result ? (
        <ToolDetails
          rows={[
            [
              "Result",
              result.replaced ? "Replaced the file" : "Created the file",
            ],
            ["Note", result.truncationNotice],
          ]}
        />
      ) : (
        <ToolResultFallback output={output} />
      )}
    </ToolRow>
  );
}
