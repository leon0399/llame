import type { ReactNode } from "react";
import { fn } from "storybook/test";

// Storybook manual mock for the active-runs context (registered globally via
// `sb.mock` in .storybook/preview.tsx). The real provider fetches + polls runs
// and `useActiveRuns` throws outside it; here it is a controllable spy so
// stories can drive the sidebar status dots without any network.
//
// Override per story in `beforeEach`:
//   useActiveRuns.mockReturnValue({ ...emptyActiveRuns(),
//     activeChatIds: new Set(["chat-1"]) })

type ActiveRunsContextValue = {
  trackRun: (runId: string, chatId: string, title: string) => void;
  untrackChat: (chatId: string) => void;
  completedChats: ReadonlySet<string>;
  markChatSeen: (chatId: string) => void;
  activeChatIds: ReadonlySet<string>;
};

/** A neutral, idle context value — no processing/unread chats. */
export function emptyActiveRuns(): ActiveRunsContextValue {
  return {
    trackRun: () => {},
    untrackChat: () => {},
    completedChats: new Set(),
    markChatSeen: () => {},
    activeChatIds: new Set(),
  };
}

export const useActiveRuns = fn(emptyActiveRuns).mockName("useActiveRuns");

/** Pass-through provider so anything rendering it in a story is a no-op. */
export function ActiveRunsProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
