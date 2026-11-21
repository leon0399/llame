/**
 * The write-once Project selection a Run freezes at its first dispatch
 * (project-discovery D2): which Project guidance the Run applies until it
 * reaches a terminal state.
 *
 * The value is persisted as the payload of the existing `run.project_bound`
 * Run event and read back through an untrusted I/O boundary, so the schema is
 * strict and versioned: an added, missing, or retyped field, an unsupported
 * version, or a non-canonical locator is a rejected payload rather than a
 * tolerated one. Callers translate a rejection into a value-free failure and
 * never fall back to live Project rows.
 *
 * Authored strings stay opaque here. The parser never inspects, trims, or
 * interpolates them into diagnostics, so invalid instructions can never reach
 * an error message.
 */
import { z } from 'zod';

/**
 * A canonical Project id: the lowercase hyphenated form Postgres stores. The
 * locator the Run records is built from it, so an uppercase id is rejected
 * rather than normalized — the recorded value has exactly one spelling.
 */
const CANONICAL_PROJECT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** One selected Project's complete model-relevant form. */
const projectSelectionSchema = z.strictObject({
  id: z.string().regex(CANONICAL_PROJECT_ID),
  // The owner API has always required a nonblank name, and the snapshot
  // renderer requires one too: a blank stored name is corrupt data, not a
  // selection the Run may carry.
  name: z.string().refine((value) => value.trim().length > 0),
  description: z.string().nullable(),
  instructions: z.string().nullable(),
  locator: z.string(),
});

/**
 * The versioned binding: version 1 holds either a complete selection or the
 * real "this Chat has no Project" decision. Extra keys and other versions are
 * invalid, never forward-interpreted.
 */
export const projectBoundPayloadSchema = z
  .strictObject({
    v: z.literal(1),
    project: projectSelectionSchema.nullable(),
  })
  .refine(
    (value) =>
      value.project === null ||
      // The locator is the canonical detail locator for this exact id:
      // lowercase scheme and UUID, no path alias, selector, escape, query, or
      // fragment.
      value.project.locator === `projects://${value.project.id}`,
    {
      message: 'Project locator is not canonical for its id.',
      path: ['project', 'locator'],
    },
  );

export type ProjectSelection = z.infer<typeof projectSelectionSchema>;

export type ProjectBoundPayload = z.infer<typeof projectBoundPayloadSchema>;

/**
 * Parse a stored or supplied selection. Returns undefined for every rejected
 * shape, including unsupported versions; it never throws and never includes
 * the rejected values in a message.
 */
export function parseProjectBoundPayload(
  value: unknown,
): ProjectBoundPayload | undefined {
  const parsed = projectBoundPayloadSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}
