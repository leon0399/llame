import { fn } from "storybook/test";

// Storybook manual mock for the pins mutations (registered globally via
// `sb.mock` in .storybook/preview.tsx). Keeps pin/unpin off the network in
// stories and exposes STABLE `mutate` spies so interaction stories can assert a
// pin/unpin was requested (mirrors chat-item.test.tsx's vi.mock seam). Import
// `pinMutate`/`unpinMutate` from this mock in a story's `play` to assert; the
// component's aliased import resolves to this same module, so the spies match.

export const pinMutate = fn().mockName("pinMutate");
export const unpinMutate = fn().mockName("unpinMutate");

export const pinItem = fn().mockName("pinItem");
export const unpinItem = fn().mockName("unpinItem");

export const usePinItem = fn(() => ({
  mutate: pinMutate,
  isPending: false,
})).mockName("usePinItem");

export const useUnpinItem = fn(() => ({
  mutate: unpinMutate,
  isPending: false,
})).mockName("useUnpinItem");
