"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import type { MessageResponseProps } from "@workspace/ui/components/ai-elements/message-response";
import type { ReasoningContentProps } from "@workspace/ui/components/ai-elements/reasoning-content";

export type ChatMarkdownRenderers = {
  MessageResponse: ComponentType<MessageResponseProps>;
  ReasoningContent: ComponentType<ReasoningContentProps>;
};

const ChatMarkdownContext = createContext<ChatMarkdownRenderers | null>(null);

// Tab-lifetime cache so Strict Mode's effect remount and chat switches do not
// drop back to the spinner after the chunks have already loaded once.
let cachedRenderers: ChatMarkdownRenderers | null = null;
let loadPromise: Promise<ChatMarkdownRenderers> | null = null;
let loadOverride: (() => Promise<ChatMarkdownRenderers>) | null = null;

function loadChatMarkdownRenderers(): Promise<ChatMarkdownRenderers> {
  if (loadOverride) return loadOverride();
  if (cachedRenderers) return Promise.resolve(cachedRenderers);
  loadPromise ??= Promise.all([
    import("@workspace/ui/components/ai-elements/message-response"),
    import("@workspace/ui/components/ai-elements/reasoning-content"),
  ]).then(([messageResponse, reasoningContent]) => {
    const loaded: ChatMarkdownRenderers = {
      MessageResponse: messageResponse.MessageResponse,
      ReasoningContent: reasoningContent.ReasoningContent,
    };
    cachedRenderers = loaded;
    return loaded;
  });
  return loadPromise;
}

/**
 * Loads the Streamdown-backed message/reasoning chunks once, then exposes the
 * real components. ChatSessionContent withholds the transcript until these
 * resolve — mounting via next/dynamic still paints empty shells even after a
 * bare `import()` preload, so the row must render these handles, not dynamic().
 */
export function ChatMarkdownProvider({ children }: { children: ReactNode }) {
  const [renderers, setRenderers] = useState<ChatMarkdownRenderers | null>(
    () => (loadOverride ? null : cachedRenderers),
  );

  useEffect(() => {
    if (!loadOverride && cachedRenderers) {
      setRenderers(cachedRenderers);
      return;
    }
    let cancelled = false;
    void loadChatMarkdownRenderers().then((loaded) => {
      if (!cancelled) setRenderers(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ChatMarkdownContext.Provider value={renderers}>
      {children}
    </ChatMarkdownContext.Provider>
  );
}

/** `null` until both renderer chunks have loaded in this tab. */
export function useChatMarkdownRenderers(): ChatMarkdownRenderers | null {
  return useContext(ChatMarkdownContext);
}

/** Resolve (and cache) the renderers — used by tests to avoid a cold-load flake. */
export function ensureChatMarkdownRenderersLoaded(): Promise<ChatMarkdownRenderers> {
  return loadChatMarkdownRenderers();
}

/** Test-only: replace the dynamic import with a controllable promise. */
export function setChatMarkdownLoadForTests(
  override: (() => Promise<ChatMarkdownRenderers>) | null,
): void {
  loadOverride = override;
  cachedRenderers = null;
  loadPromise = null;
}
