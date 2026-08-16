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
  registerViewedChat: (chatId: string) => () => void;
  completedChats: ReadonlySet<string>;
  markChatSeen: (chatId: string) => void;
  activeChatIds: ReadonlySet<string>;
};

/** A neutral, idle context value — no processing/unread chats. */
export function emptyActiveRuns(): ActiveRunsContextValue {
  return {
    trackRun: () => {},
    untrackChat: () => {},
    registerViewedChat: () => () => {},
    completedChats: new Set(),
    markChatSeen: () => {},
    activeChatIds: new Set(),
  };
}

export const useActiveRuns = fn(emptyActiveRuns).mockName("useActiveRuns");

/**
 * The real module's provider-optional read (the admin shell mounts the pinned
 * rail without a provider). Delegates to the `useActiveRuns` spy so one
 * `mockReturnValue` in a story drives every row, whichever variant it calls —
 * and so this mock keeps exporting everything the real module does, which the
 * production Storybook build checks even though dev does not.
 */
export const useOptionalActiveRuns = fn(() => useActiveRuns()).mockName(
  "useOptionalActiveRuns",
);

/** Pass-through provider so anything rendering it in a story is a no-op. */
export function ActiveRunsProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
