"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  useContext,
  useEffect,
  useState,
} from "react";
import { type BundledLanguage, codeToHtml, type ShikiTransformer } from "shiki";

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  /** Source text to highlight. */
  code: string;
  /** Shiki `BundledLanguage` id (e.g. `"ts"`, `"tsx"`, `"bash"`) selecting the grammar. */
  language: BundledLanguage;
  /** Renders a muted, non-selectable line-number gutter before each line. */
  showLineNumbers?: boolean;
};

type CodeBlockContextType = {
  code: string;
};

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: "",
});

const lineNumberTransformer: ShikiTransformer = {
  name: "line-numbers",
  line(node, line) {
    node.children.unshift({
      type: "element",
      tagName: "span",
      properties: {
        className: [
          "inline-block",
          "min-w-10",
          "mr-4",
          "text-right",
          "select-none",
          "text-muted-foreground",
        ],
      },
      children: [{ type: "text", value: String(line) }],
    });
  },
};

export async function highlightCode(
  code: string,
  language: BundledLanguage,
  showLineNumbers = false,
) {
  const transformers: Array<ShikiTransformer> = showLineNumbers
    ? [lineNumberTransformer]
    : [];

  return await Promise.all([
    codeToHtml(code, {
      lang: language,
      theme: "one-light",
      transformers,
    }),
    codeToHtml(code, {
      lang: language,
      theme: "one-dark-pro",
      transformers,
    }),
  ]);
}

/**
 * CodeBlock renders `code` as Shiki-highlighted markup, producing separate
 * light/dark themed output shown via `dark:` classes so no runtime theme
 * lookup is needed. Highlighting runs asynchronously after mount, so the
 * first render briefly shows unhighlighted content. Compose `children` (e.g.
 * `CodeBlockCopyButton`) to overlay actions on top of the block.
 *
 * @see https://elements.ai-sdk.dev/components/code-block
 * @summary for rendering a highlighted, themed code snippet
 */
export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const [html, setHtml] = useState<string>("");
  const [darkHtml, setDarkHtml] = useState<string>("");
  useEffect(() => {
    // Ignore a stale highlight that resolves after `code` changed (content
    // still streaming in) so the latest result always wins.
    let active = true;
    highlightCode(code, language, showLineNumbers).then(([light, dark]) => {
      if (active) {
        setHtml(light);
        setDarkHtml(dark);
      }
    });

    return () => {
      active = false;
    };
  }, [code, language, showLineNumbers]);

  return (
    <CodeBlockContext.Provider value={{ code }}>
      <div
        className={cn(
          "group relative w-full overflow-hidden rounded-md border bg-background text-foreground",
          className,
        )}
        {...props}
      >
        <div className="relative">
          <div
            className="overflow-auto dark:hidden [&>pre]:m-0 [&>pre]:bg-background! [&>pre]:p-4 [&>pre]:text-foreground! [&>pre]:text-sm [&_code]:font-mono [&_code]:text-sm"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: "this is needed."
            // safe-html: shiki codeToHtml output (see the codeToHtml calls above); shiki escapes the source and wraps it in its own spans
            dangerouslySetInnerHTML={{ __html: html }}
          />
          <div
            className="hidden overflow-auto dark:block [&>pre]:m-0 [&>pre]:bg-background! [&>pre]:p-4 [&>pre]:text-foreground! [&>pre]:text-sm [&_code]:font-mono [&_code]:text-sm"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: "this is needed."
            // safe-html: shiki codeToHtml output (see the codeToHtml calls above); shiki escapes the source and wraps it in its own spans
            dangerouslySetInnerHTML={{ __html: darkHtml }}
          />
          {children && (
            <div className="absolute top-2 right-2 flex items-center gap-2">
              {children}
            </div>
          )}
        </div>
      </div>
    </CodeBlockContext.Provider>
  );
};

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  /** Called after the code is successfully copied to the clipboard. */
  onCopy?: () => void;
  /** Called when the clipboard write fails, e.g. the Clipboard API is unavailable. */
  onError?: (error: Error) => void;
  /** Milliseconds the copied checkmark is shown before reverting. Defaults to 2000. */
  timeout?: number;
};

/**
 * CodeBlockCopyButton copies the nearest ancestor `CodeBlock`'s source text
 * to the clipboard and briefly swaps its icon to a checkmark. Render it as a
 * child of `CodeBlock` so it can read the code from context.
 *
 * @summary for copying a CodeBlock's source to the clipboard
 */
export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false);
  const { code } = useContext(CodeBlockContext);

  const copyToClipboard = async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      onError?.(new Error("Clipboard API not available"));
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      onCopy?.();
      setTimeout(() => setIsCopied(false), timeout);
    } catch (error) {
      // SAFETY: the try block's only fallible call is
      // navigator.clipboard.writeText, which rejects with a DOMException — an
      // Error subtype — per the Clipboard API spec.
      onError?.(error as Error);
    }
  };

  const Icon = isCopied ? CheckIcon : CopyIcon;

  return (
    <Button
      className={cn("shrink-0", className)}
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon size={14} />}
    </Button>
  );
};
