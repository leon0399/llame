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
import { ImageThumbnail } from "@workspace/ui/components/custom/image-thumbnail";
import { SearchLink } from "@workspace/ui/components/custom/web-search";

const lineRangeSchema = z.object({
  startLine: z.number(),
  endLine: z.number(),
});

/** Fields every successful read carries, whatever it returned. */
const readSourceFields = {
  status: z.literal("success"),
  path: z.string(),
  realPath: z.string().optional(),
  finalUrl: z.string().optional(),
  method: z.string().optional(),
  // `route` and `origin` are optional so results stored before they existed
  // still parse.
  adapter: z
    .object({
      id: z.string(),
      route: z.string().optional(),
      origin: z.string().optional(),
    })
    .optional(),
  notes: z.array(z.string()).optional(),
};

/** The native read result and the web envelope. Loose, so a scheme envelope
 *  (`kb://` space identity and notice, `skill://` paths) survives parsing and
 *  renders as a detail row instead of disappearing. */
const textOutputSchema = z.looseObject({
  ...readSourceFields,
  kind: z.enum(["file", "directory"]),
  content: z.string(),
  truncated: z.boolean(),
  nextOffset: z.number().optional(),
  representation: z.string().optional(),
  requestedRange: lineRangeSchema.nullable().optional(),
  requestedRanges: z.array(lineRangeSchema).optional(),
  shownRange: lineRangeSchema.nullable().optional(),
  shownRanges: z.array(lineRangeSchema).optional(),
});

/** A read whose bytes were an image: the stored object's `media://` locator
 *  and the original's type and size, with no content. Loose for the same
 *  scheme envelopes as a text read. */
const imageOutputSchema = z.looseObject({
  ...readSourceFields,
  kind: z.literal("image"),
  media: z.string(),
  mediaType: z.string(),
  width: z.number(),
  height: z.number(),
});

type ReadOutput = z.infer<typeof textOutputSchema>;
type ImageReadOutput = z.infer<typeof imageOutputSchema>;
type LineRange = z.infer<typeof lineRangeSchema>;

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
  /** Thumbnail URL for an image result's `media://` locator, or `null` when
   *  it has none; without it an image result shows no thumbnail. */
  imageSrc?: (media: string) => string | null;
  /** Opens an image result's thumbnail (the chat's lightbox). */
  onOpenImage?: () => void;
};

function formatRanges(
  ranges: ReadonlyArray<LineRange> | undefined,
  range: LineRange | null | undefined,
): string | undefined {
  const all = ranges ?? (range ? [range] : []);
  if (all.length === 0) return undefined;
  return all
    .map(({ startLine, endLine }) =>
      startLine === endLine ? `${startLine}` : `${startLine}–${endLine}`,
    )
    .join(", ");
}

function truncation(output: ReadOutput): string | undefined {
  if (!output.truncated) return undefined;
  // A directory's nextOffset counts entries, not lines.
  return output.kind === "file" && output.nextOffset !== undefined
    ? `continues at line ${output.nextOffset + 1}`
    : "yes";
}

/** A rewrite adapter fetches another host, so its route and origin name
 *  where the content actually came from. */
function methodLabel(output: ReadOutput | ImageReadOutput): string | undefined {
  const { adapter, method } = output;
  if (!adapter) return method;
  const provenance = [
    adapter.id,
    adapter.route === "native" ? undefined : adapter.route,
    adapter.origin && `via ${adapter.origin}`,
  ].filter(Boolean);
  return `${method ?? "adapter"} (${provenance.join(", ")})`;
}

/** Every field `schema` does not declare, under its own key, so no envelope
 *  is ever dropped. */
function envelopeRows(
  output: ReadOutput | ImageReadOutput,
  schema: typeof textOutputSchema | typeof imageOutputSchema,
): Array<[string, string]> {
  return Object.entries(output)
    .filter(([key]) => !Object.hasOwn(schema.shape, key))
    .map(([key, value]): [string, string] => [
      key,
      z.string().safeParse(value).data ?? JSON.stringify(value),
    ]);
}

/** Labelled rows for everything the source header and content do not show. */
function metadataRows(output: ReadOutput): Array<[string, string]> {
  const rows: Array<[string, string | undefined]> = [
    [
      "Requested lines",
      formatRanges(output.requestedRanges, output.requestedRange),
    ],
    ["Shown lines", formatRanges(output.shownRanges, output.shownRange)],
    [
      "Representation",
      output.representation === "text" ? undefined : output.representation,
    ],
    ["Method", methodLabel(output)],
    ["Truncated", truncation(output)],
    ...(output.notes ?? []).map((note): [string, string] => ["Note", note]),
    ...envelopeRows(output, textOutputSchema),
  ];
  return rows.filter((row): row is [string, string] => row[1] !== undefined);
}

/** An image result's rows: the stored original's size and format, the
 *  locator a later turn can read again, and the shared source rows. */
function imageMetadataRows(output: ImageReadOutput): Array<[string, string]> {
  const format = output.mediaType.replace(/^image\//, "").toUpperCase();
  const rows: Array<[string, string | undefined]> = [
    ["Image", `${output.width}×${output.height} ${format}`],
    ["Media", output.media],
    ["Method", methodLabel(output)],
    ...(output.notes ?? []).map((note): [string, string] => ["Note", note]),
    ...envelopeRows(output, imageOutputSchema),
  ];
  return rows.filter((row): row is [string, string] => row[1] !== undefined);
}

function ReadMetadata({ rows }: { rows: Array<[string, string]> }) {
  return (
    <ul className="space-y-0.5 border-border border-t px-4 py-3 text-muted-foreground text-xs">
      {rows.map(([label, value], index) => (
        <li className="break-words" key={`${label}-${index}`}>
          <span className="font-medium">{label}:</span> {value}
        </li>
      ))}
    </ul>
  );
}

function ReadSource({
  output,
  Markdown,
}: {
  output: ReadOutput | ImageReadOutput;
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
      <ReadMetadata rows={metadataRows(output)} />
    </div>
  );
}

function ReadImageBody({
  output,
  Markdown,
  imageSrc,
  onOpenImage,
}: {
  output: ImageReadOutput;
  Markdown: ComponentType<{ children?: string }>;
  imageSrc: ReadToolProps["imageSrc"];
  onOpenImage: ReadToolProps["onOpenImage"];
}) {
  const src = imageSrc?.(output.media) ?? null;
  return (
    <div className="space-y-4">
      <ReadSource output={output} Markdown={Markdown} />
      {src !== null && (
        <div className="px-4">
          <ImageThumbnail src={src} alt={output.path} onOpen={onOpenImage} />
        </div>
      )}
      <ReadMetadata rows={imageMetadataRows(output)} />
    </div>
  );
}

function ReadResult({
  output,
  Markdown,
  imageSrc,
  onOpenImage,
}: Pick<ReadToolProps, "output" | "Markdown" | "imageSrc" | "onOpenImage">) {
  const textOutput = textOutputSchema.safeParse(output).data;
  if (textOutput) return <ReadBody output={textOutput} Markdown={Markdown} />;
  const imageOutput = imageOutputSchema.safeParse(output).data;
  if (imageOutput) {
    return (
      <ReadImageBody
        output={imageOutput}
        Markdown={Markdown}
        imageSrc={imageSrc}
        onOpenImage={onOpenImage}
      />
    );
  }
  if (output !== undefined) {
    return <ToolOutput output={output} errorText={undefined} />;
  }
  return <p className="p-4 text-muted-foreground text-sm">Reading…</p>;
}

/**
 * Renders a native `read` invocation: the source it identified, the content
 * as the model received it, and how much of the source that content covers.
 * An image result shows a thumbnail of the stored image instead of content.
 *
 * @summary displays a file, directory, image, or web read inside a collapsible tool row
 */
export function ReadTool({
  input,
  output,
  errorText,
  state,
  Markdown,
  imageSrc,
  onOpenImage,
}: ReadToolProps): ReactElement {
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
        ) : (
          <ReadResult
            output={output}
            Markdown={Markdown}
            imageSrc={imageSrc}
            onOpenImage={onOpenImage}
          />
        )}
      </ToolContent>
    </Tool>
  );
}
