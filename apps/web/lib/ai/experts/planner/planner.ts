import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatPromptTemplate } from "@langchain/core/prompts";

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

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

const plan = zodToJsonSchema(
  z.object({
    steps: z
      .array(z.string())
      .describe("different steps to follow, should be in sorted order"),
  }),
);
const planFunction = {
  name: "plan",
  description: "This tool is used to plan the steps to follow",
  parameters: plan,
};

export const planTool = {
  type: "function",
  function: planFunction,
};

// const plannerPrompt = ChatPromptTemplate.fromTemplate(
//   `For the given objective, come up with a simple step by step plan. \
// This plan should involve individual tasks, that if executed correctly will yield the correct answer. Do not add any superfluous steps. \
// The result of the final step should be the final answer. Make sure that each step has all the information needed - do not skip steps.

// {objective}`,
// );
const plannerPrompt = ChatPromptTemplate.fromMessages([
  ["system", SYSTEM_MESSAGE],
  ["developer", `Based on the conversation, come up with a simple step by step plan. This plan should involve individual tasks, that if executed correctly will yield the correct answer. Do not add any superfluous steps. The result of the final step should be the final answer. Make sure that each step has all the information needed - do not skip steps.`],
  ["placeholder", "{messages}"],
])

export const createPlanner = ({
  llm,
}: {
  llm: BaseChatModel;
}) => {
  const planner = plannerPrompt
    .pipe(llm.withStructuredOutput(planTool));

  return planner;
}