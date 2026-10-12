import { z } from "zod";

/**
 * The display-only thumbnail the api stores beside an image it did not keep
 * (a `read` image result or a prompt-import image entry): a base64 WebP data
 * URL of at most 65,536 characters. Anything else is never used as an image
 * `src`.
 */
export const inlineThumbnailSchema = z
  .string()
  .max(65_536)
  .regex(/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/);
