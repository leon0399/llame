import { fn } from "storybook/test";

import type { MemorySettingsUpdate } from "../types";

export const updateMemoryMutate =
  fn<(input: MemorySettingsUpdate) => void>().mockName("updateMemoryMutate");

export const useUpdateMemoryMutation = fn(
  (): {
    isError: boolean;
    mutate: typeof updateMemoryMutate;
  } => ({ isError: false, mutate: updateMemoryMutate }),
).mockName("useUpdateMemoryMutation");
