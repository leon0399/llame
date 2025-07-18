import { Annotation, AnnotationRoot, END, Messages, messagesStateReducer, START, StateGraph } from "@langchain/langgraph";
import { Runnable, RunnableConfig, RunnableToolLike } from "@langchain/core/runnables";

import { createPlanner } from "./planner";
import { createReplanner } from "./replanner";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { LanguageModelLike } from "@langchain/core/language_models/base";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createReactAgent, ToolNode } from "@langchain/langgraph/prebuilt";
import { DynamicTool, StructuredToolInterface } from "@langchain/core/tools";

// type ServerTool = Record<string, unknown>;
// type ClientTool = StructuredToolInterface | DynamicTool | RunnableToolLike;

// function isClientTool(tool: ClientTool | ServerTool): tool is ClientTool {
//   return Runnable.isRunnable(tool);
// }

// // eslint-disable-next-line @typescript-eslint/no-explicit-any
// type AnyAnnotationRoot = AnnotationRoot<any>;

const PlanExecuteState = Annotation.Root({
  // input: Annotation<string>({
  //   reducer: (x, y) => y ?? x ?? "",
  // }),
  messages: Annotation<string|(BaseMessage|string)[]|Messages>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  plan: Annotation<string[]>({
    reducer: (x, y) => y ?? x ?? [],
  }),
  pastSteps: Annotation<[string, string][]>({
    reducer: (x, y) => x.concat(y),
  }),
  response: Annotation<string>({
    reducer: (x, y) => y ?? x,
  }),
})

export type CreatePlannerAgentParams = {
  /** The chat model that can utilize OpenAI-style tool calling. */
  llm: BaseChatModel;

  /** A list of tools or a ToolNode. */
  // tools: ToolNode | (ServerTool | ClientTool)[];
  
  /**
   * An optional name for the agent.
   */
  name?: string;

  agentExecutor: ReturnType<typeof createReactAgent>;
};

export const createPlannerAgent = ({
  name = "planner-agent",
  llm,
  // tools,
  agentExecutor,
}: CreatePlannerAgentParams) => {
  // let toolClasses: (ClientTool | ServerTool)[];

  // let toolNode: ToolNode;
  // if (!Array.isArray(tools)) {
  //   toolClasses = tools.tools;
  //   toolNode = tools;
  // } else {
  //   toolClasses = tools;
  //   toolNode = new ToolNode(toolClasses.filter(isClientTool));
  // }

  const planner = createPlanner({ llm });

  async function planStep(
    state: typeof PlanExecuteState.State,
  ): Promise<Partial<typeof PlanExecuteState.State>> {
    const plan = await planner.invoke({ messages: state.messages });
    return { plan: plan.steps };
  }

  const replanner = createReplanner({ llm });
  async function replanStep(
    state: typeof PlanExecuteState.State,
  ): Promise<Partial<typeof PlanExecuteState.State>> {
    const output = await replanner.invoke({
      messages: state.messages,
      plan: state.plan.join("\n"),
      pastSteps: state.pastSteps
        .map(([step, result]) => `${step}: ${result}`)
        .join("\n"),
    });
    const toolCall = output[0];

    if (toolCall.type == "response") {
      return { response: toolCall.args?.response };
    }

    return { plan: toolCall.args?.steps };
  }

  async function executeStep(
    state: typeof PlanExecuteState.State,
    config?: RunnableConfig,
  ): Promise<Partial<typeof PlanExecuteState.State>> {
    const task = state.plan[0];
    const input = {
      messages: [new HumanMessage(task)],
    };
    const { messages } = await agentExecutor.invoke(input, config);

    return {
      pastSteps: [[task, messages[messages.length - 1].content.toString()]],
      plan: state.plan.slice(1),
    };
  }

  function shouldEnd(state: typeof PlanExecuteState.State) {
    return state.response ? "true" : "false";
  }

  const workflow = new StateGraph(PlanExecuteState)
    .addNode("planner", planStep)
    .addNode("agent", executeStep)
    .addNode("replan", replanStep)
    .addEdge(START, "planner")
    .addEdge("planner", "agent")
    .addEdge("agent", "replan")
    .addConditionalEdges("replan", shouldEnd, {
      true: END,
      false: "agent",
    });


  return workflow.compile({
    name: "planner-workflow",
  })
}