import {
  setChatMarkdownRenderersForTests,
  type ChatMarkdownRenderers,
} from "@/app/(chat)/components/use-chat-markdown-ready";

/** Pass-through renderers that write a part's text as-is. */
export const STUB_CHAT_MARKDOWN_RENDERERS: ChatMarkdownRenderers = {
  MessageResponse: ({ children }) => <>{children}</>,
  ReasoningContent: ({ children }) => <>{children}</>,
};

/**
 * Starts the suite from a warm renderer cache holding pass-through renderers,
 * the state a tab reaches after its first load, for suites that assert
 * transcript text rather than rendered Markdown. Skipping the real Streamdown
 * import removes the slowest step under jsdom, which nothing in such a suite
 * depends on. Pair with `setChatMarkdownRenderersForTests(null)` afterwards.
 */
export function installStubChatMarkdownRenderers(): void {
  setChatMarkdownRenderersForTests(STUB_CHAT_MARKDOWN_RENDERERS);
}
