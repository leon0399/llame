import { createContext, useContext } from "react";

/** The size of the model and effort triggers: `xs` in a row of quiet
 *  settings (the regenerate menu, the row under the input), `default`
 *  inside the composer's toolbar, the height of its attach and send buttons,
 *  so every control on that line is one size. */
export const ComposerControlSize = createContext<"xs" | "default">("xs");

export function useComposerControlSize() {
  return useContext(ComposerControlSize);
}
