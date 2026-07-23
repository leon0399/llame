import { cn } from "@workspace/ui/lib/utils";
import { marked } from "marked";
import { memo, useId, useMemo } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  CodeBlock,
  CodeBlockCode,
} from "@workspace/ui/components/custom/code-block";

export type MarkdownProps = {
  /**
   * Markdown source to render (GitHub Flavored Markdown, plus soft line
   * breaks). Split into top-level blocks that are memoized independently, so
   * streaming updates only re-parse the blocks that changed.
   */
  children: string;
  /** Base id used to key each memoized block; auto-generated via `useId` when omitted. */
  id?: string;
  className?: string;
  /**
   * Overrides for the `react-markdown` component map. Defaults to a map
   * that renders fenced code through `CodeBlock`/`CodeBlockCode` (syntax
   * highlighting) and inline code as a styled `<span>`.
   */
  components?: Partial<Components>;
};

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown);
  return tokens.map((token) => token.raw);
}

function extractLanguage(className?: string): string {
  if (!className) return "plaintext";
  const match = className.match(/language-(\w+)/);
  return match ? match[1] : "plaintext";
}

const INITIAL_COMPONENTS: Partial<Components> = {
  code: function CodeComponent({ className, children, ...props }) {
    const isInline =
      !props.node?.position?.start.line ||
      props.node?.position?.start.line === props.node?.position?.end.line;

    if (isInline) {
      return (
        <span
          className={cn(
            "bg-primary-foreground rounded-sm px-1 font-mono text-sm",
            className,
          )}
          {...props}
        >
          {children}
        </span>
      );
    }

    const language = extractLanguage(className);

    return (
      <CodeBlock className={className}>
        <CodeBlockCode code={children as string} language={language} />
      </CodeBlock>
    );
  },
  pre: function PreComponent({ children }) {
    return <>{children}</>;
  },
};

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
    components = INITIAL_COMPONENTS,
  }: {
    content: string;
    components?: Partial<Components>;
  }) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    );
  },
  function propsAreEqual(prevProps, nextProps) {
    return prevProps.content === nextProps.content;
  },
);

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock";

/**
 * Markdown renders a Markdown string to React elements, splitting it into
 * per-block memoized chunks so re-renders during streaming (e.g.
 * token-by-token chat responses) skip re-parsing blocks that haven't
 * changed. Fenced code blocks render through `CodeBlock`/`CodeBlockCode` for
 * syntax highlighting.
 *
 * @summary renders a Markdown string to React elements, block-memoized for streaming
 */
function MarkdownComponent({
  children,
  id,
  className,
  components = INITIAL_COMPONENTS,
}: MarkdownProps) {
  const generatedId = useId();
  const blockId = id ?? generatedId;
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children]);

  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock
          key={`${blockId}-block-${index}`}
          content={block}
          components={components}
        />
      ))}
    </div>
  );
}

const Markdown = memo(MarkdownComponent);
Markdown.displayName = "Markdown";

export { Markdown };
