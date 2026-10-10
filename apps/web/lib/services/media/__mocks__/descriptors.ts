import { fn } from "storybook/test";

// Type-only import: erased at runtime, so it cannot re-enter the sb.mock
// redirect the way a value re-export would.
import type { MediaDescriptor } from "../uploads";

// Storybook manual mock for media descriptors (registered globally via
// `sb.mock` in .storybook/preview.tsx).

/** Never settles by default; stories set the descriptors per test. (The web
 *  lib targets pre-ES2024, so no `Promise.withResolvers`.) */
export const fetchMediaDescriptor = fn(
  (_id: string): Promise<MediaDescriptor> =>
    new Promise<MediaDescriptor>(() => {}),
).mockName("fetchMediaDescriptor");
