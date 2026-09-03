import { fn } from "storybook/test";

import type { UpdateMemoryDto } from "../../../api/generated/models";

export const updateMemoryMutate =
  fn<(input: UpdateMemoryDto) => void>().mockName("updateMemoryMutate");

export const useUpdateMemoryMutation = fn(
  () =>
    ({ isError: false, mutate: updateMemoryMutate }) satisfies {
      isError: boolean;
      mutate: typeof updateMemoryMutate;
    },
).mockName("useUpdateMemoryMutation");
