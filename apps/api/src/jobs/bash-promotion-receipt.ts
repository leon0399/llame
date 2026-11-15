import { isRecord, isString, type ToolResult } from '@workspace/runtime-safety';

export function toolResultFromReceipt(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- durable event payloads are untrusted JSON and are checked before use.
  payload: unknown,
): ToolResult | undefined {
  if (!isRecord(payload) || !isRecord(payload['result'])) return undefined;

  const result = payload['result'];

  const errorResult =
    result['status'] === 'error' &&
    isString(result['type']) &&
    isString(result['message']);

  if (result['status'] !== 'success' && !errorResult) return undefined;

  // SAFETY: native.result is append-only; error results carry their discriminator and message.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return result as ToolResult;
}

export function jobSequence(result: ToolResult): number | undefined {
  if (!('job' in result) || !isString(result.job)) return undefined;
  const match = /^job:\/\/bash-(\d+)$/.exec(result.job);

  return match === null ? undefined : Number(match[1]);
}
