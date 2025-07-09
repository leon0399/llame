import { defaultModelId, getModels } from '@/lib/ai/models';

import { ChatPromptTemplate, MessagesPlaceholder, PromptTemplate, SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { HttpResponseOutputParser } from "langchain/output_parsers";
import { LangChainAdapter, Message as VercelChatMessage, UIMessage as VercelUIMessage } from "ai";
import { AIMessage, ChatMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

const SYSTEM_MESSAGE = 
`###INSTRUCTIONS###

You MUST ALWAYS:
- BE LOGICAL
- ONLY IF you working with coding tasks: I have no fingers and the placeholders trauma: NEVER use placeholders or omit the code (in any code snippets)
- If you encounter a character limit, DO an ABRUPT stop; I will send a "continue" as a new message
- You will be PENALIZED for wrong answers
- You DENIED to overlook the critical context
- ALWAYS follow ###Answering rules###

###Answering Rules###

Follow in the strict order:

1. USE the language of my message
2. In the FIRST message, assign a real-world expert role to yourself before answering, e.g., "I'll answer as a world-famous historical expert <detailed topic> with <most prestigious LOCAL topic REAL award>" or "I'll answer as a world-famous <specific science> expert in the <detailed topic> with <most prestigious LOCAL topic award>"
3. You MUST combine your deep knowledge of the topic and clear thinking to quickly and accurately decipher the answer step-by-step with CONCRETE details
4. I'm going to tip $1,000,000 for the best reply
5. Your answer is critical for my career
6. Answer the question in a natural, human-like manner
7. ALWAYS use an ##Answering example## for a first message structure

##Answering example##

// IF THE CHATLOG IS EMPTY:
<I'll answer as the world-famous %REAL specific field% scientists with %most prestigious REAL LOCAL award%>

**TL;DR**: <TL;DR, skip for rewriting>

<Step-by-step answer with CONCRETE details and key context>`;

const convertVercelMessageToLangChainMessage = (message: VercelChatMessage) => {
  if (message.role === "user") {
    return new HumanMessage(message.content);
  } else if (message.role === "assistant") {
    return new AIMessage(message.content);
  } else {
    return new ChatMessage(message.content, message.role);
  }
};

const models = getModels();

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "data"]),
  content: z.string(),
});

const chatRequestSchema = z.object({
  id: z.string(),
  messages: z.array(messageSchema),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
});

export async function POST(req: Request) {
  const parsedBody = chatRequestSchema.safeParse(await req.json());
  if (!parsedBody.success) {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const requestMessages = parsedBody.data.messages as VercelChatMessage[];
  
  const selectedModel = parsedBody.data.model || defaultModelId;
  const model = models.find(m => m.id === selectedModel)?.instance;
  if (!model) {
    throw new Error(`Model not found: ${selectedModel}`);
  }

  const messages = requestMessages.map(convertVercelMessageToLangChainMessage);

  const promptTemplate = ChatPromptTemplate.fromMessages([
    new SystemMessage(parsedBody.data.systemPrompt || SYSTEM_MESSAGE),
    new MessagesPlaceholder("msgs"),
  ]);

  const stream = await promptTemplate.pipe(model).stream({
    msgs: messages,
  })

  return LangChainAdapter.toDataStreamResponse(stream);
}