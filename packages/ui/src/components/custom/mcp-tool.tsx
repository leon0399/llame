"use client";

import type { ReactElement } from "react";
import { z } from "zod";

import { CodeBlock } from "@workspace/ui/components/ai-elements/code-block";
import { ScrollRegion } from "@workspace/ui/components/custom/scroll-region";
import {
  type ToolPartProps,
  ToolResultFallback,
  ToolRow,
  ToolSection,
  ToolText,
} from "@workspace/ui/components/custom/tool-row";

const textBlockSchema = z.object({ type: z.literal("text"), text: z.string() });
const imageBlockSchema = z.object({
  type: z.literal("image"),
  mimeType: z.string(),
});

/** The raw MCP `CallToolResult`, wrapped in llame's success envelope. */
const outputSchema = z.looseObject({
  status: z.literal("success"),
  output: z.looseObject({
    content: z.array(z.unknown()).optional(),
    structuredContent: z.unknown().optional(),
  }),
});

/** Props for an MCP tool row. */
export type McpToolProps = ToolPartProps & {
  /** The namespaced tool id, `mcp__<server>__<tool>`. */
  name: string;
};

/** `server · tool` for a namespaced id. Server ids never contain `__`, so
 *  the first separator after the prefix splits them; the tool may. */
export function mcpToolTitle(name: string): string {
  const rest = name.replace(/^mcp__/u, "");
  const separator = rest.indexOf("__");
  return separator === -1
    ? rest
    : `${rest.slice(0, separator)} · ${rest.slice(separator + 2)}`;
}

/** A value the row has no dedicated view for, as highlighted JSON. */
function McpJson({ label, value }: { label: string; value: unknown }) {
  return (
    <ScrollRegion label={label} className="rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(value, null, 2)} language="json" />
    </ScrollRegion>
  );
}

/** One content block. Text stays verbatim, never Markdown, because the
 *  remote server is untrusted; a remote image is named, never loaded. */
function McpBlock({ block }: { block: unknown }) {
  const text = textBlockSchema.safeParse(block).data;
  if (text) return <ToolText label="Text content" text={text.text} />;
  const image = imageBlockSchema.safeParse(block).data;
  if (image) {
    return (
      <p className="text-muted-foreground text-sm">Image ({image.mimeType})</p>
    );
  }
  return <McpJson label="Content block" value={block} />;
}

function McpResult({ output }: { output: z.infer<typeof outputSchema> }) {
  const blocks = output.output.content ?? [];
  const structured = output.output.structuredContent;
  return (
    <>
      <ToolSection label="Result">
        {blocks.length === 0 ? (
          <p className="text-muted-foreground text-sm">No content.</p>
        ) : (
          blocks.map((block, index) => (
            // Blocks have no identity beyond their position.
            <McpBlock block={block} key={index} />
          ))
        )}
      </ToolSection>
      {structured === undefined ? null : (
        <ToolSection label="Structured content">
          <McpJson label="Structured content" value={structured} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Renders a call to an operator-configured MCP tool: `server · tool` in the
 * header, the arguments, then the result's content blocks (text verbatim,
 * images named only, anything else as JSON) and any structured content.
 *
 * @summary displays an MCP tool call inside a collapsible tool row
 */
export function McpTool({
  name,
  input,
  output,
  errorText,
  state,
}: McpToolProps): ReactElement {
  const result = outputSchema.safeParse(output).data;
  const firstString = Object.values(
    z.record(z.string(), z.unknown()).safeParse(input).data ?? {},
  ).find((value) => z.string().safeParse(value).success);
  return (
    <ToolRow
      name={name}
      title={mcpToolTitle(name)}
      summary={z.string().safeParse(firstString).data}
      input={input}
      errorText={errorText}
      state={state}
    >
      {result ? (
        <McpResult output={result} />
      ) : (
        <ToolResultFallback output={output} />
      )}
    </ToolRow>
  );
}
