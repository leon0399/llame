import { fn } from "storybook/test";

// Type-only import: erased at runtime, so it cannot re-enter the sb.mock
// redirect the way a value import would.
import type { RunContextReceipt } from "../runs";

// Storybook manual mock for the run helpers (registered globally via
// `sb.mock` in .storybook/preview.tsx). `useRunContextReceipt` is a
// controllable spy so the effective-context-inspector stories can present a
// receipt without a backend (mirrors effective-context-inspector.test.tsx's
// vi.mock seam); the remaining exports are inert stand-ins so any other
// storied component importing this module stays off the network.

export const runQueryKeys = {
  all: ["runs"] as const,
  contextReceipt: (runId: string) => ["runs", runId, "context"] as const,
};

type MockedReceiptQuery = {
  isPending: boolean;
  isError: boolean;
  data: RunContextReceipt | undefined;
};

export const useRunContextReceipt = fn(
  (): MockedReceiptQuery => ({
    isPending: true,
    isError: false,
    data: undefined,
  }),
).mockName("useRunContextReceipt");

export const fetchRunContextReceipt = fn().mockName("fetchRunContextReceipt");
export const runContextReceiptQueryOptions = fn().mockName(
  "runContextReceiptQueryOptions",
);
export const runIdToCancel = fn(() => null).mockName("runIdToCancel");
export const cancelRun = fn().mockName("cancelRun");
