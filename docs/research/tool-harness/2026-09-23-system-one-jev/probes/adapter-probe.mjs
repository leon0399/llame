import { createOpenAI } from "../../../../../apps/api/node_modules/@ai-sdk/openai/dist/index.mjs";
import {
  generateText,
  jsonSchema,
} from "../../../../../apps/api/node_modules/ai/dist/index.mjs";
const captured = [];
const provider = createOpenAI({
  apiKey: "synthetic-offline-key",
  fetch: async (_url, options) => {
    captured.push(JSON.parse(options.body));
    return new Response(
      JSON.stringify({
        id: "resp_probe",
        created_at: 0,
        model: "gpt-6-sol",
        object: "response",
        status: "completed",
        output: [
          {
            id: "msg_probe",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "Captured locally.",
                annotations: [],
              },
            ],
          },
        ],
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  },
});
const schema = jsonSchema({
  type: "object",
  properties: {},
  additionalProperties: false,
});
const tools = {
  whoards_lookup: { description: "Look up vocabulary.", inputSchema: schema },
  atlassian_search: { description: "Search issues.", inputSchema: schema },
};
for (const mode of ["allowedTools", "activeTools"]) {
  await generateText({
    model: provider.responses("gpt-6-sol"),
    prompt: "Find this vocabulary word.",
    tools,
    maxRetries: 0,
    ...(mode === "allowedTools"
      ? {
          providerOptions: {
            openai: {
              allowedTools: { toolNames: ["whoards_lookup"], mode: "auto" },
            },
          },
        }
      : { activeTools: ["whoards_lookup"] }),
  });
}
console.log(
  JSON.stringify(
    captured.map((body, i) => ({
      mode: ["allowedTools", "activeTools"][i],
      tools: body.tools.map((t) => t.name),
      tool_choice: body.tool_choice,
    })),
    null,
    2,
  ),
);
