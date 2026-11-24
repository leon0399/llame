import { z } from 'zod';

export const conversationSourceChatIdSchema = z.guid();

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
 * Internal message-local windows used to construct canonical search locators.
 * The native `read` tool accepts the resulting `chat://` locator.
 */
export const conversationSourceCoordinatesSchema = z.strictObject({
  chatId: conversationSourceChatIdSchema,
  messageSeq: conversationSourceMessageSeqSchema,
  offset: conversationSourceOffsetSchema,
  limit: conversationSourceLimitSchema,
});

export type ConversationSourceCoordinates = z.infer<
  typeof conversationSourceCoordinatesSchema
>;
