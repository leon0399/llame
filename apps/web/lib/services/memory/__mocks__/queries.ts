import { fn } from "storybook/test";

import type { MemorySettings } from "../types";

export const memoryQueryKeys = {
  all: ["memory"] as const,
  mine: () => [...memoryQueryKeys.all, "me"] as const,
};

export const fetchMemory = fn().mockName("fetchMemory");

export const useMemoryQuery = fn(
  (): {
    data: MemorySettings | undefined;
    isPending: boolean;
  } => ({ data: undefined, isPending: true }),
).mockName("useMemoryQuery");
