import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { JsonOutputToolsParser } from "@langchain/core/output_parsers/openai_tools";
import { ChatPromptTemplate } from "@langchain/core/prompts";

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { planTool } from "./planner";

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

const response = zodToJsonSchema(
  z.object({
    response: z.string().describe("Response to user."),
  }),
);

const responseTool = {
  type: "function",
  function: {
    name: "response",
    description: "Response to user.",
    parameters: response,
  },
};

// const replannerPrompt = ChatPromptTemplate.fromTemplate(
//   `For the given objective, come up with a simple step by step plan. 
// This plan should involve individual tasks, that if executed correctly will yield the correct answer. Do not add any superfluous steps.
// The result of the final step should be the final answer. Make sure that each step has all the information needed - do not skip steps.

// Your objective was this:
// {input}

// Your original plan was this:
// {plan}

// You have currently done the follow steps:
// {pastSteps}

// Update your plan accordingly. If no more steps are needed and you can return to the user, then respond with that and use the 'response' function.
// Otherwise, fill out the plan.  
// Only add steps to the plan that still NEED to be done. Do not return previously done steps as part of the plan.`,
// );

const replannerPrompt = ChatPromptTemplate.fromMessages([
  ["system", SYSTEM_MESSAGE],
  ["developer", `Based on the conversation, come up with a simple step by step plan.
This plan should involve individual tasks, that if executed correctly will yield the correct answer. Do not add any superfluous steps.
The result of the final step should be the final answer. Make sure that each step has all the information needed - do not skip steps.

Your original plan was this:
{plan}

You have currently done the following steps:
{pastSteps}

Update your plan accordingly. If no more steps are needed and you can return to the user, then respond with that and use the 'response' function.
Otherwise, fill out the plan.
Only add steps to the plan that still NEED to be done. Do not return previously done steps as part of the plan.`],
  ["placeholder", "{messages}"],
])

const parser = new JsonOutputToolsParser();

export const createReplanner = ({
  llm,
}: {
  llm: BaseChatModel;
}) => {
  if (!llm.bindTools || typeof llm.pipe !== "function") {
    throw new Error("Invalid LLM instance");
  }

  return replannerPrompt
  .pipe(llm.bindTools([planTool, responseTool]))
  .pipe(parser);
};