import { fn } from "storybook/test";

// Type-only import: erased at runtime, so it cannot re-enter the sb.mock
// redirect the way a value re-export would.
import type { MediaDescriptor } from "../uploads";

// Storybook manual mock for media uploads (registered globally via `sb.mock`
// in .storybook/preview.tsx). The constant is re-declared rather than
// re-exported from "../uploads": sb.mock redirects that specifier back to
// THIS module, so a re-export would be a circular self-import.

export const ATTACHABLE_IMAGE_TYPES: ReadonlyArray<string> = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

/** Never settles by default; stories set the outcome per test. (The web lib
 *  targets pre-ES2024, so no `Promise.withResolvers`.) */
export const uploadImage = fn(
  (_file: File): Promise<MediaDescriptor> =>
    new Promise<MediaDescriptor>(() => {}),
).mockName("uploadImage");
