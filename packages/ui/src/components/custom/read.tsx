"use client";

import type { ComponentType, ReactElement } from "react";
import { z } from "zod";

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolHeaderState,
} from "@workspace/ui/components/ai-elements/tool";
import { SearchLink } from "@workspace/ui/components/custom/web-search";

const lineRangeSchema = z.object({
  startLine: z.number(),
  endLine: z.number(),
});

/** The native read result plus the web envelope; other fields are ignored. */
const outputSchema = z.object({
  status: z.literal("success"),
  kind: z.enum(["file", "directory"]),
  path: z.string(),
  content: z.string(),
  truncated: z.boolean(),
  nextOffset: z.number().optional(),
  realPath: z.string().optional(),
  shownRange: lineRangeSchema.nullable().optional(),
  shownRanges: z.array(lineRangeSchema).optional(),
  finalUrl: z.string().optional(),
  method: z.string().optional(),
  adapter: z.object({ id: z.string() }).optional(),
  notes: z.array(z.string()).optional(),
});

type ReadOutput = z.infer<typeof outputSchema>;

/** Props for the dedicated read tool row. */
export type ReadToolProps = {
  /** Tool arguments shown in the shared Parameters panel. */
  input: unknown;
  /** Native read output; malformed values fall back to generic JSON. */
  output: unknown;
  /** Error returned by the tool, if the invocation failed. */
  errorText: string | undefined;
  /** Current lifecycle state, including llame's cancellation state. */
  state: ToolHeaderState;
  /** Markdown renderer supplied by the chat so web links use link safety. */
  Markdown: ComponentType<{ children?: string }>;
};

function shownLines(output: ReadOutput): string | undefined {
  const ranges =
    output.shownRanges ?? (output.shownRange ? [output.shownRange] : []);
  if (ranges.length === 0) return undefined;
  return ranges
    .map(({ startLine, endLine }) =>
      startLine === endLine ? `${startLine}` : `${startLine}–${endLine}`,
    )
    .join(", ");
}

function ReadMetadata({ output }: { output: ReadOutput }) {
  const lines = shownLines(output);
  const method = output.adapter
    ? `${output.method ?? "adapter"} (${output.adapter.id})`
    : output.method;

  return (
    <div className="border-border border-t px-4 py-3 text-muted-foreground text-xs">
      {lines && (
        <p>
          <span className="font-medium">Lines:</span> {lines}
        </p>
      )}
      {method && (
        <p>
          <span className="font-medium">Method:</span> {method}
        </p>
      )}
      {output.truncated && (
        <p>
          <span className="font-medium">Truncated</span>
          {output.kind === "file" && output.nextOffset !== undefined
            ? ` — continues at line ${output.nextOffset + 1}`
            : null}
        </p>
      )}
      {output.notes && output.notes.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {output.notes.map((note, index) => (
            <li key={`${note}-${index}`}>
              <span className="font-medium">Note:</span> {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReadSource({
  output,
  Markdown,
}: {
  output: ReadOutput;
  Markdown: ComponentType<{ children?: string }>;
}) {
  return (
    <div className="space-y-1 px-4 pt-4 text-sm">
      {output.finalUrl ? (
        <SearchLink
          label={output.finalUrl}
          url={output.finalUrl}
          Markdown={Markdown}
        />
      ) : (
        <p className="break-all font-mono text-xs">{output.path}</p>
      )}
      {output.realPath && (
        <p className="break-all text-muted-foreground text-xs">
          <span className="font-medium">Resolves to:</span>{" "}
          <span className="font-mono">{output.realPath}</span>
        </p>
      )}
    </div>
  );
}

function ReadBody({
  output,
  Markdown,
}: {
  output: ReadOutput;
  Markdown: ComponentType<{ children?: string }>;
}) {
  return (
    <div className="space-y-4">
      <ReadSource output={output} Markdown={Markdown} />
      <div className="px-4">
        {output.content === "" ? (
          <p className="text-muted-foreground text-sm">No content.</p>
        ) : (
          // Wrapped, not scrolled: a scroll container would need keyboard focus.
          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-xs">
            {output.content}
          </pre>
        )}
      </div>
      <ReadMetadata output={output} />
    </div>
  );
}

/**
 * Renders a native `read` invocation: the source it identified, the content
 * as the model received it, and how much of the source that content covers.
 *
 * @summary displays a file, directory, or web read inside a collapsible tool row
 */
export function ReadTool({
  input,
  output,
  errorText,
  state,
  Markdown,
}: ReadToolProps): ReactElement {
  const validOutput = outputSchema.safeParse(output).data;

  return (
    <Tool>
      <ToolHeader state={state} type="tool-read" />
      <ToolContent>
        <ToolInput input={input} />
        {state === "cancelled" ? null : errorText ? (
          <ToolOutput
            errorText={errorText}
            output={undefined}
            state="output-error"
          />
        ) : validOutput ? (
          <ReadBody output={validOutput} Markdown={Markdown} />
        ) : output !== undefined ? (
          <ToolOutput output={output} errorText={undefined} />
        ) : (
          <p className="p-4 text-muted-foreground text-sm">Reading…</p>
        )}
      </ToolContent>
    </Tool>
  );
}
