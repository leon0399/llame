import { fn } from "storybook/test";

// Storybook manual mock for the fork mutation (registered globally via
// `sb.mock` in .storybook/preview.tsx). Exposes a STABLE `forkMutate` spy so
// interaction stories can assert a fork was requested and drive its
// onSuccess callback (mirrors message-fork-button.test.tsx's vi.mock seam).

export const forkMutate = fn().mockName("forkMutate");

export const forkChat = fn().mockName("forkChat");

export const useForkChat = fn(() => ({
  mutate: forkMutate,
  isPending: false,
})).mockName("useForkChat");
