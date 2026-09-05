import { isString } from '@workspace/runtime-safety';
import { CliError } from './errors';
import { record, text } from './validation';
import { type UnknownRecord, type ToolResult } from '@workspace/runtime-safety';

export interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

export interface Message {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  readonly tool_calls?: readonly ToolCall[];
  readonly tool_call_id?: string;
  readonly reasoning_content?: string;
}

export interface ToolDefinition {
  readonly type: 'function';
  readonly function: { readonly name: string; readonly description: string; readonly parameters: UnknownRecord };
}

export interface RunEvent {
  readonly runId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly payload: unknown;
}

export type Approval = (description: string, signal: AbortSignal) => Promise<boolean>;
export type ToolExecution = (name: string, args: unknown, signal: AbortSignal) => Promise<ToolResult>;

/** Revalidate persisted/wire framing; never turn arbitrary JSON into a message. */
export function parseMessage(value: unknown): Message {
  const input = record(value, 'message');
  const role = input.role;
  if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') {
    throw new CliError('message_role', 'Invalid message role.');
  }
  if (input.content !== null && !isString(input.content)) throw new CliError('message_content', 'Invalid message content.');
  const toolCalls = input.tool_calls === undefined ? undefined : parseCalls(input.tool_calls);
  const callId = input.tool_call_id === undefined ? undefined : text(input.tool_call_id, 'tool call ID', 200);
  if (role === 'tool' && !callId) throw new CliError('message_tool', 'Tool observations need a call ID.');
  return { role, content: input.content, tool_calls: toolCalls, tool_call_id: callId,
    reasoning_content: input.reasoning_content === undefined ? undefined : text(input.reasoning_content, 'reasoning content', 1_048_576) };
}

function parseCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value) || value.length > 16) throw new CliError('tool_limit', 'At most 16 tool calls are allowed per step.');
  return value.map((entry) => {
    const call = record(entry, 'tool call'); const fn = record(call.function, 'tool function');
    if (call.type !== 'function') throw new CliError('tool_type', 'Only function tools are supported.');
    return { id: text(call.id, 'tool call ID', 200), type: 'function',
      function: { name: text(fn.name, 'tool name', 100), arguments: text(fn.arguments, 'tool arguments', 262_144) } };
  });
}
