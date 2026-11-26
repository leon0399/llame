import { z } from 'zod';

export type SearchPositionValue = {
  readonly path: string;
  readonly line: number;
  readonly byteOffset?: bigint;
};

export type HubCursor = {
  readonly after: SearchPositionValue;
  readonly inputHash: string;
};

const hubCursorSchema = z.object({
  after: z.object({
    path: z.string(),
    line: z.number().int().safe().nonnegative(),
    byteOffset: z
      .string()
      .regex(/^(0|[1-9]\d*)$/u)
      .transform((value) => BigInt(value))
      .optional(),
  }),
  inputHash: z.string(),
});

export function cursorEncode(cursor: HubCursor): string {
  const serialized = {
    ...cursor,
    after: {
      ...cursor.after,
      byteOffset: cursor.after.byteOffset?.toString(),
    },
  };

  return Buffer.from(JSON.stringify(serialized), 'utf8').toString('base64url');
}

export function cursorDecode(
  text: string,
  inputHash: string,
): SearchPositionValue | undefined {
  if (!/^[\w-]+$/u.test(text)) return undefined;

  try {
    const parsed = hubCursorSchema.safeParse(
      JSON.parse(Buffer.from(text, 'base64url').toString('utf8')),
    );

    if (!parsed.success || parsed.data.inputHash !== inputHash)
      return undefined;

    return parsed.data.after;
  } catch {
    return undefined;
  }
}
