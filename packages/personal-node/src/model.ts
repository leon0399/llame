import { isRecord, isString, type UnknownRecord } from '@workspace/runtime-safety';
import { type LocalConfig, type LocalModel } from './config';
import { request, sse } from './http';
import { CliError } from './errors';
import { integer, parseJson, record, text } from './validation';
import { type Message, type ToolCall, type ToolDefinition } from './types';

interface MutableCall { id: string; name: string; arguments: string; }

/** Narrow wire adapter for operator-selected OpenAI-compatible endpoints. */
export async function complete(model: LocalModel, config: LocalConfig, messages: readonly Message[],
  tools: readonly ToolDefinition[], signal: AbortSignal, onText: (delta: string) => void): Promise<Message> {
  const body: UnknownRecord = { model: model.model, messages, stream: true, max_tokens: config.maxOutputTokens };
  if (tools.length) body.tools = tools;
  if (Buffer.byteLength(JSON.stringify(body)) + config.maxOutputTokens * 4 > config.maxContextBytes) {
    throw new CliError('context_limit', 'Conversation exceeds the configured context byte budget. Start a new chat; no history was silently dropped.');
  }
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream' };
  if (model.apiKey) headers.authorization = `Bearer ${model.apiKey}`;
  const response = await request(`${model.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) }, signal);
  const accumulator = new CompletionAccumulator(onText);
  for await (const frame of sse(response)) {
    if (frame.data === '[DONE]') break;
    accumulator.add(record(parseJson(frame.data), 'completion chunk'));
  }
  return accumulator.finish();
}

class CompletionAccumulator {
  private content = '';
  private reasoning = '';
  private reason: string | null = null;
  private readonly calls = new Map<number, MutableCall>();
  private bytes = 0;
  constructor(private readonly onText: (delta: string) => void) {}

  add(chunk: UnknownRecord): void {
    if (chunk.error) throw new CliError('provider_error', 'Provider returned a streaming error.');
    if (!Array.isArray(chunk.choices)) throw new CliError('provider_protocol', 'Expected completion choices.');
    if (chunk.choices.length === 0) return; // Usage-only final chunk.
    if (chunk.choices.length !== 1) throw new CliError('provider_protocol', 'Expected exactly one completion choice.');
    const choice = record(chunk.choices[0], 'completion choice');
    if (this.reason !== null) throw new CliError('provider_protocol', 'Provider sent another completion after its finish marker.');
    const delta = record(choice.delta, 'completion delta');
    this.bytes += Buffer.byteLength(JSON.stringify(delta));
    if (this.bytes > 1_048_576) throw new CliError('output_limit', 'Model response exceeds 1 MiB.');
    if (isString(delta.content)) { this.content += delta.content; this.onText(delta.content); }
    if (isString(delta.reasoning_content)) this.reasoning += delta.reasoning_content;
    if (delta.tool_calls !== undefined) this.addCalls(delta.tool_calls);
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) this.reason = text(choice.finish_reason, 'finish reason', 100);
  }

  private addCalls(value: unknown): void {
    if (!Array.isArray(value) || value.length > 16) throw new CliError('tool_limit', 'Invalid tool-call fragment array.');
    for (const entry of value) {
      const fragment = record(entry, 'tool fragment');
      const index = integer(fragment.index, 'tool index', 0, 15);
      const call = this.calls.get(index) ?? { id: '', name: '', arguments: '' };
      if (fragment.type !== undefined && fragment.type !== 'function') throw new CliError('tool_type', 'Only function tools are supported.');
      if (isString(fragment.id)) call.id += fragment.id;
      if (isRecord(fragment.function)) {
        if (isString(fragment.function.name)) call.name += fragment.function.name;
        if (isString(fragment.function.arguments)) call.arguments += fragment.function.arguments;
      }
      if (call.id.length > 200 || call.name.length > 100 || call.arguments.length > 262_144) throw new CliError('tool_limit', 'Tool-call assembly exceeds its limit.');
      this.calls.set(index, call);
    }
  }

  finish(): Message {
    if (this.reason !== 'stop' && this.reason !== 'tool_calls') {
      throw new CliError('incomplete_completion', 'Model did not finish normally. Partial text is retained as events; partial tool calls were not executed.');
    }
    const calls: ToolCall[] = [...this.calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => ({
      id: text(call.id, 'tool call ID', 200), type: 'function',
      function: { name: text(call.name, 'tool name', 100), arguments: text(call.arguments, 'tool arguments', 262_144) },
    }));
    if (new Set(calls.map((call) => call.id)).size !== calls.length || (this.reason === 'tool_calls') !== (calls.length > 0)) {
      throw new CliError('provider_protocol', 'Tool-call IDs or completion finish reason are inconsistent.');
    }
    return { role: 'assistant', content: this.content || null, tool_calls: calls.length ? calls : undefined,
      reasoning_content: this.reasoning || undefined };
  }
}
