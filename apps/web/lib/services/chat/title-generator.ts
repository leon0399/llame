import { getModels, CHAT_TITLE_GENERATION_MODEL_ID } from "@/lib/ai/models";
import { BaseMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";

export const TITLE_SYSTEM_PROMPT = `You are tasked with generating a concise, descriptive title for a conversation between a user and an AI assistant. The title should capture the main topic or purpose of the conversation.

Guidelines for title generation:
- Keep titles extremely short (ideally 2-5 words)
- Focus on the main topic or goal of the conversation
- Use natural, readable language
- Avoid unnecessary articles (a, an, the) when possible
- Do not include quotes or special characters
- Capitalize important words

Examples of titles:
- 📉 Stock Market Trends
- 🍪 완벽한 초콜릿 칩 레시피
- 流媒体音乐的演变
- Советы по повышению производительности удаленной работы
- Künstliche Intelligenz im Gesundheitswesen
- 🎮 ビデオゲーム開発の洞察

Use the 'generate_title' tool to output your title.`;

export const TITLE_USER_PROMPT = `Based on the following conversation, generate a very short and descriptive title for:

{conversation}
`;

const generateTitleTool = {
  name: "generate_title",
  description: "Generate a concise title for the conversation",
  schema: z.object({
    title: z.string().describe("The generated title for the conversation"),
  }),
}

const promptTemplate = ChatPromptTemplate.fromMessages([
  ["system", TITLE_SYSTEM_PROMPT],
  ["user", TITLE_USER_PROMPT],
]);

export async function generateConversationTitle(
  messages: BaseMessage[],
): Promise<string> {
  const models = getModels();
  const model = models.find(m => m.id === CHAT_TITLE_GENERATION_MODEL_ID)?.instance;
  if (!model) {
    throw new Error(`Model not found: ${CHAT_TITLE_GENERATION_MODEL_ID}`);
  }

  if (!("bindTools" in model) || typeof model.bindTools !== "function") {
    throw new Error("Model does not support tools");
  }

  const modelWithTools = model.bindTools([generateTitleTool], {
    tool_choice: "generate_title",
  });

  const conversation = messages.map(msg => `<${msg.getType()}>\n${msg.content}\n</${msg.getType()}>`).join("\n\n");

  const result = await promptTemplate.pipe(modelWithTools).invoke({
    conversation,
  });

  const titleToolCall = result.tool_calls?.[0];
  if (!titleToolCall) {
    console.error("FAILED TO GENERATE TOOL CALL", result);
    throw new Error("Title generation tool call failed.");
  }

  return titleToolCall.args.title;
}