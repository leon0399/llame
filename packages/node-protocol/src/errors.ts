/** Only explicitly public errors may cross a Node transport. */
export class NodeProtocolError extends Error {
  constructor(readonly code: string, message: string, readonly rpcCode = -32602) {
    super(message);
    this.name = 'NodeProtocolError';
  }
}

export function protocolError(error: unknown) {
  const safe = error instanceof NodeProtocolError ? error :
    new NodeProtocolError('operation_failed', 'Node operation failed. No request was retried.', -32603);
  return { code: safe.rpcCode, message: safe.message, data: { code: safe.code, exitCode: 1 } };
}
