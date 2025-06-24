'use server';

import { generateObject, generateText, type UIMessage } from 'ai';
import { cookies } from 'next/headers';
import {
  deleteMessagesByChatIdAfterTimestamp,
  getMessageById,
  updateChatVisiblityById,
} from '@/lib/db/queries';
import type { VisibilityType } from '@/components/visibility-selector';
import { titleModel } from '@/lib/ai/providers';
import { z } from 'zod';

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set('chat-model', model);
}

export async function generateTitleFromUserMessage({
  messages,
}: {
  messages: UIMessage[];
}) {
  const { object: { title } } = await generateObject({
    model: titleModel,
    system: `### Task:
Generate a concise, 2-4 word title with an emoji summarizing the chat history.

### Guidelines:
- The title should clearly represent the main theme or subject of the conversation.
- Avoid quotation marks or special formatting
- Use words so sparingly so that the title will fit to 214px column with 14px font
- Never cut or truncate the title
- Never use emojis
- Use sentence-style capitalization in most titles and headings: Only capitalize the first word and lowercase the rest. First word must start with a big letter.
- Write the title in the chat's primary language
- Prioritize accuracy over excessive creativity; keep it clear and simple.
- Your entire response must consist solely of the JSON object, without any introductory or concluding text.
- The output must be a single, raw JSON object, without any markdown code fences or other encapsulating text.
- Ensure no conversational text, affirmations, or explanations precede or follow the raw JSON output, as this will cause direct parsing failure.

### Output:
JSON format: { "title": "your concise title here" }

### Examples:
- { "title": "Stock market trends" },
- { "title": "Perfect chocolate chip recipe" },
- { "title": "Evolution of music streaming" },
- { "title": "Remote work productivity tips" },
- { "title": "Artificial intelligence in healthcare" },
- { "title": "Video game development insights" }
    `,
    messages,
    schema: z.object({
      title: z.string().describe('The title of the chat'),
    }),
  });

  return title;
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const [message] = await getMessageById({ id });

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
  });
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  await updateChatVisiblityById({ chatId, visibility });
}
