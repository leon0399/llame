"use client";

import { cn } from "@workspace/ui/lib/utils";
import React, { useEffect, useState } from "react";
import {
  codeToHtml,
  bundledLanguages,
  bundledLanguagesAlias,
  bundledLanguagesBase,
} from "shiki";

const isLanguageSupported = (lang: string): boolean => {
  return (
    Object.keys(bundledLanguages).includes(lang) ||
    Object.keys(bundledLanguagesAlias).includes(lang) ||
    Object.keys(bundledLanguagesBase).includes(lang)
  );
};

export type CodeBlockProps = {
  /**
   * Content of the block — typically a single `CodeBlockCode`, optionally
   * preceded by a `CodeBlockGroup` header.
   */
  children?: React.ReactNode;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

/**
 * CodeBlock is the bordered, rounded container for a code snippet — compose
 * it with `CodeBlockCode` (and optionally a `CodeBlockGroup` header) to
 * render highlighted code in chat messages, docs, or tool output.
 *
 * @summary container for a highlighted code snippet
 */
function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "not-prose flex w-full flex-col overflow-clip border",
        "border-border bg-card text-card-foreground rounded-xl",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type CodeBlockCodeProps = {
  /** Raw source code to syntax-highlight. */
  code: string;
  /**
   * Shiki bundled language id (e.g. `"typescript"`, `"bash"`). Falls back to
   * `"plaintext"` when the id isn't a recognized Shiki language.
   */
  language?: string;
  /** Shiki bundled theme id (e.g. `"github-light"`, `"github-dark"`). */
  theme?: string;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

/**
 * CodeBlockCode asynchronously highlights `code` with Shiki and renders the
 * resulting markup, falling back to a plain `<pre><code>` until
 * highlighting resolves (or when `code` is empty).
 *
 * @summary syntax-highlighted code, rendered via Shiki
 */
function CodeBlockCode({
  code,
  language = "plaintext",
  theme = "github-light",
  className,
  ...props
}: CodeBlockCodeProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  useEffect(() => {
    async function highlight() {
      if (!code) {
        setHighlightedHtml("<pre><code></code></pre>");
        return;
      }

      const html = await codeToHtml(code, {
        lang: isLanguageSupported(language) ? language : "plaintext",
        theme,
      });
      setHighlightedHtml(html);
    }
    highlight();
  }, [code, language, theme]);

  const classNames = cn(
    "w-full overflow-x-auto text-[13px] [&>pre]:px-4 [&>pre]:py-4",
    className,
  );

  // SSR fallback: render plain code if not hydrated yet
  return highlightedHtml ? (
    <div
      className={classNames}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      {...props}
    />
  ) : (
    <div className={classNames} {...props}>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * CodeBlockGroup is a flex header row for a `CodeBlock` — e.g. a filename
 * label alongside a copy-to-clipboard action — placed above `CodeBlockCode`.
 *
 * @summary header row for a CodeBlock, e.g. filename + actions
 */
function CodeBlockGroup({
  children,
  className,
  ...props
}: CodeBlockGroupProps) {
  return (
    <div
      className={cn("flex items-center justify-between", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock };
