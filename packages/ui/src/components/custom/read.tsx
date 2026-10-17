"use client";

import { type ComponentType, type ReactElement, useState } from "react";
import { z } from "zod";

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolHeaderState,
} from "@workspace/ui/components/ai-elements/tool";
import { MediaThumbnail } from "@workspace/ui/components/custom/media-thumbnail";
import {
  ImageDimensionsTile,
  imageSizeLabel,
  MediaLightbox,
  type MediaLightboxSlide,
  mediaCaption,
} from "@workspace/ui/components/custom/media-lightbox";
import { ScrollRegion } from "@workspace/ui/components/custom/scroll-region";
import { SearchLink } from "@workspace/ui/components/custom/web-search";
import { inlineThumbnailSchema } from "@workspace/ui/lib/inline-thumbnail";

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

/** A read whose bytes were an image, with the original's type and size and no
 *  content: a `media://` read carries the stored object's locator, any other
 *  read the display-only inline `thumbnail` (used only when it is a valid
 *  WebP data URL; absent when it would exceed the cap). Loose for the same
 *  scheme envelopes as a text read. */
const imageOutputSchema = z.looseObject({
  ...readSourceFields,
  kind: z.literal("image"),
  media: z.string().optional(),
  thumbnail: z.unknown().optional(),
  mediaType: z.string(),
  width: z.number(),
  height: z.number(),
});

/** A read whose bytes were a PDF, with the original's page count and size and
 *  no content: only a `media://` read carries the stored object's locator,
 *  which is also where a later turn reads it again. Loose for the same scheme
 *  envelopes as a text read. */
const pdfOutputSchema = z.looseObject({
  ...readSourceFields,
  kind: z.literal("pdf"),
  media: z.string().optional(),
  mediaType: z.string(),
  pages: z.number(),
  byteSize: z.number(),
});

type ReadOutput = z.infer<typeof textOutputSchema>;
type ImageReadOutput = z.infer<typeof imageOutputSchema>;
type PdfReadOutput = z.infer<typeof pdfOutputSchema>;
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
  /** The thumbnail and original URLs of a stored media result's `media://`
   *  locator, or `null` when it has none: an image's tile and lightbox image,
   *  or the original a PDF's tile links to. An unstored image result shows its
   *  inline `thumbnail` instead; without either it shows its size only. */
  mediaSources?: (media: string) => MediaSources | null;
};

/** Where a stored media result loads from: an image's thumbnail and lightbox
 *  image, or the original a PDF tile links to. */
export type MediaSources = { thumbnail: string; original: string };

/** The locator the model submitted to `read`: its input `path`. */
const submittedPathSchema = z.object({ path: z.string() });

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
function methodLabel(
  output: ReadOutput | ImageReadOutput | PdfReadOutput,
): string | undefined {
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
  output: ReadOutput | ImageReadOutput | PdfReadOutput,
  schema:
    | typeof textOutputSchema
    | typeof imageOutputSchema
    | typeof pdfOutputSchema,
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

/** An image result's rows: the original's size and format, the stored
 *  locator a later turn can read again (if any), and the shared source rows. */
function imageMetadataRows(output: ImageReadOutput): Array<[string, string]> {
  const rows: Array<[string, string | undefined]> = [
    ["Image", imageSizeLabel(output)],
    ["Media", output.media],
    ["Method", methodLabel(output)],
    ...(output.notes ?? []).map((note): [string, string] => ["Note", note]),
    ...envelopeRows(output, imageOutputSchema),
  ];
  return rows.filter((row): row is [string, string] => row[1] !== undefined);
}

/** A PDF result's rows: the original's page count and byte size, the stored
 *  locator a later turn can read again (if any), and the shared source rows. */
function pdfMetadataRows(output: PdfReadOutput): Array<[string, string]> {
  const rows: Array<[string, string | undefined]> = [
    ["PDF", pdfSizeLabel(output)],
    ["Media", output.media],
    ["Method", methodLabel(output)],
    ...(output.notes ?? []).map((note): [string, string] => ["Note", note]),
    ...envelopeRows(output, pdfOutputSchema),
  ];
  return rows.filter((row): row is [string, string] => row[1] !== undefined);
}

/** The original's page count and byte size, e.g. `15 pages · 2.1 MiB`. */
function pdfSizeLabel({ pages, byteSize }: PdfReadOutput): string {
  let size: string;
  if (byteSize < 1024) {
    size = `${byteSize} B`;
  } else if (byteSize < 1024 * 1024) {
    size = `${(byteSize / 1024).toFixed(1)} KiB`;
  } else {
    size = `${(byteSize / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${pages} ${pages === 1 ? "page" : "pages"} · ${size}`;
}

/** The file name a PDF result's tile shows: the last non-empty segment of the
 *  path of the locator the read settled on — the api names the model-facing
 *  file the same way, a web URL by its path — or `document.pdf` when no
 *  segment is left. A `media://` read therefore names the stored id. */
function pdfName({ path, finalUrl }: PdfReadOutput): string {
  // A locator's path only: drop the scheme and authority, then any query or
  // fragment.
  const locator = (finalUrl ?? path).replace(/^[a-z][a-z0-9+.-]*:\/\//iu, "");
  const pathOnly = locator.slice(locator.indexOf("/") + 1).split(/[?#]/u)[0];
  const segment = (pathOnly ?? "").split("/").filter(Boolean).at(-1);
  return segment ?? "document.pdf";
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
  output: ReadOutput | ImageReadOutput | PdfReadOutput;
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
          // Cap height so a large read cannot inflate the transcript when
          // expanded. ScrollRegion is tab-focusable — Firefox/Safari omit
          // bare overflow nodes from the tab order (Chromium does not).
          <ScrollRegion
            label="File contents"
            className="rounded-md bg-muted/50"
          >
            <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs">
              {output.content}
            </pre>
          </ScrollRegion>
        )}
      </div>
      <ReadMetadata rows={metadataRows(output)} />
    </div>
  );
}

type ReadImageProps = Pick<ReadToolProps, "input" | "mediaSources"> & {
  output: ImageReadOutput;
};

/** The thumbnail and lightbox slide of an image result, or `null` when there
 *  is no thumbnail: a stored image opens its original, an unstored one its
 *  inline thumbnail captioned with the locator the model submitted. */
function readImageSlide({
  output,
  input,
  mediaSources,
}: ReadImageProps): { thumbnail: string; slide: MediaLightboxSlide } | null {
  const key = "image";
  if (output.media !== undefined) {
    const sources = mediaSources?.(output.media);
    if (!sources) return null;
    const caption = mediaCaption(output.media, output);
    return {
      thumbnail: sources.thumbnail,
      slide: { key, src: sources.original, alt: output.path, caption },
    };
  }
  const thumbnail = inlineThumbnailSchema.safeParse(output.thumbnail).data;
  if (thumbnail === undefined) return null;
  const locator = submittedPathSchema.safeParse(input).data?.path;
  const caption = mediaCaption(locator ?? output.path, output);
  return {
    thumbnail,
    slide: { key, src: thumbnail, alt: output.path, caption },
  };
}

/** The result's thumbnail opening it in a lightbox, or its size alone. */
function ReadImagePreview(props: ReadImageProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const preview = readImageSlide(props);
  const { width, height, mediaType } = props.output;
  if (preview === null) {
    return (
      <ImageDimensionsTile
        width={width}
        height={height}
        mediaType={mediaType}
      />
    );
  }
  return (
    <>
      <MediaThumbnail
        kind="image"
        src={preview.thumbnail}
        alt={preview.slide.alt}
        onOpen={() => setOpenKey(preview.slide.key)}
      />
      <MediaLightbox
        slides={[preview.slide]}
        openKey={openKey}
        onOpenKeyChange={setOpenKey}
      />
    </>
  );
}

function ReadImageBody({
  Markdown,
  ...props
}: ReadImageProps & { Markdown: ComponentType<{ children?: string }> }) {
  return (
    <div className="space-y-4">
      <ReadSource output={props.output} Markdown={Markdown} />
      <div className="px-4">
        <ReadImagePreview {...props} />
      </div>
      <ReadMetadata rows={imageMetadataRows(props.output)} />
    </div>
  );
}

type ReadPdfProps = Pick<ReadToolProps, "mediaSources"> & {
  output: PdfReadOutput;
};

/** The document tile of a PDF result, named after the locator the read
 *  settled on. Only a stored PDF links anywhere: its tile opens the original
 *  in a new tab, while an unstored one stays static and is never loaded as an
 *  image. */
function ReadPdfBody({
  output,
  Markdown,
  mediaSources,
}: ReadPdfProps & { Markdown: ComponentType<{ children?: string }> }) {
  const href =
    output.media === undefined
      ? undefined
      : mediaSources?.(output.media)?.original;
  return (
    <div className="space-y-4">
      <ReadSource output={output} Markdown={Markdown} />
      <div className="px-4">
        <MediaThumbnail kind="pdf" name={pdfName(output)} href={href} />
      </div>
      <ReadMetadata rows={pdfMetadataRows(output)} />
    </div>
  );
}

function ReadResult({
  input,
  output,
  Markdown,
  mediaSources,
}: Pick<ReadToolProps, "input" | "output" | "Markdown" | "mediaSources">) {
  const textOutput = textOutputSchema.safeParse(output).data;
  if (textOutput) return <ReadBody output={textOutput} Markdown={Markdown} />;
  const imageOutput = imageOutputSchema.safeParse(output).data;
  if (imageOutput) {
    return (
      <ReadImageBody
        input={input}
        output={imageOutput}
        Markdown={Markdown}
        mediaSources={mediaSources}
      />
    );
  }
  const pdfOutput = pdfOutputSchema.safeParse(output).data;
  if (pdfOutput) {
    return (
      <ReadPdfBody
        output={pdfOutput}
        Markdown={Markdown}
        mediaSources={mediaSources}
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
 * An image result shows a thumbnail instead of content (its inline
 * `thumbnail`, or the stored image for a `media://` read) that opens it in a
 * lightbox, or only its size when it has neither. A PDF result shows a
 * document tile named after the locator it settled on, with the original's
 * page count and byte size; a `media://` PDF's tile opens the stored original
 * in a new tab, while an unstored PDF's tile is static.
 *
 * @summary displays a file, directory, image, PDF, or web read inside a collapsible tool row
 */
export function ReadTool({
  input,
  output,
  errorText,
  state,
  Markdown,
  mediaSources,
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
            input={input}
            output={output}
            Markdown={Markdown}
            mediaSources={mediaSources}
          />
        )}
      </ToolContent>
    </Tool>
  );
}
