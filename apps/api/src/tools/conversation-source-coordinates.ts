import { z } from 'zod';

export const conversationSourceChatIdSchema = z.string().uuid();

export const conversationSourceMessageSeqSchema = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, {
    message: 'The message sequence must be a safe integer.',
  });

export const conversationSourceOffsetSchema = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger, {
    message: 'The read offset must be a safe integer.',
  });

export const conversationSourceLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(2000)
  .refine(Number.isSafeInteger, {
    message: 'The read limit must be a safe integer.',
  });

/**
 * Internal line-read coordinates shared by conversation search and the
 * conversation_read tool. This is deliberately not a tool declaration: the
 * reader owns that public input surface and composes this exact contract.
 */
export const conversationSourceCoordinatesSchema = z
  .object({
    chatId: conversationSourceChatIdSchema,
    messageSeq: conversationSourceMessageSeqSchema,
    offset: conversationSourceOffsetSchema,
    limit: conversationSourceLimitSchema,
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
