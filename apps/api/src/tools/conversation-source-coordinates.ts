import { z } from 'zod';

/**
 * Internal line-read coordinates shared by conversation search and the future
 * conversation_read tool. This is deliberately not a tool declaration: the
 * reader owns that public input surface and composes this exact contract.
 */
export const conversationSourceCoordinatesSchema = z
  .object({
    chatId: z.string().uuid(),
    messageSeq: z.number().int().positive().refine(Number.isSafeInteger, {
      message: 'The message sequence must be a safe integer.',
    }),
    offset: z.number().int().nonnegative().refine(Number.isSafeInteger, {
      message: 'The read offset must be a safe integer.',
    }),
    limit: z.number().int().min(1).max(2_000).refine(Number.isSafeInteger, {
      message: 'The read limit must be a safe integer.',
    }),
  })
  .strict();

export type ConversationSourceCoordinates = z.infer<
  typeof conversationSourceCoordinatesSchema
>;

export function parseConversationSourceCoordinates(
  value: unknown,
): ConversationSourceCoordinates {
  return conversationSourceCoordinatesSchema.parse(value);
}
