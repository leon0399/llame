export type McpFailureStage = 'initialize' | 'discovery' | 'refresh' | 'call';

export type McpFailureKind =
  | 'http'
  | 'network'
  | 'malformed_protocol'
  | 'body_limit'
  | 'tool_error'
  | 'is_error'
  | 'invalid_output'
  | 'timeout'
  | 'cancelled';

export type McpFailureSignal = Readonly<{
  stage: McpFailureStage;
  kind: McpFailureKind;
  status?: unknown;
  hasSession?: boolean;
}>;

export type McpFailureDisposition = 'reconnect' | 'call_local';

function isHttpFailureStatus(status: unknown): status is number {
  return (
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
  );
}

// classifyMcpFailure fails closed (default/else branches below) for a stage
// or kind it doesn't recognize — a real possibility once a remote MCP server
// evolves ahead of this client. The parameter type says so honestly: it
// accepts the closed literal unions every trusted call site already
// constructs, plus any other string, rather than a narrower type this
// function's own control flow doesn't actually require.
export function classifyMcpFailure(
  failure: Readonly<{
    stage: McpFailureStage | (string & {});
    kind: McpFailureKind | (string & {});
    status?: unknown;
    hasSession?: boolean;
  }>,
): McpFailureDisposition {
  // Every non-'call' stage ('initialize', 'discovery', 'refresh', and
  // anything this client doesn't yet recognize) reconnects; only a 'call'
  // failure's kind needs the finer classification below.
  if (failure.stage !== 'call') {
    return 'reconnect';
  }

  switch (failure.kind) {
    case 'network':
    case 'malformed_protocol':
    case 'body_limit':
      return 'reconnect';

    case 'http':
      if (!isHttpFailureStatus(failure.status)) {
        return 'reconnect';
      }

      if (
        failure.status === 401 ||
        failure.status === 403 ||
        (failure.status === 404 && failure.hasSession === true)
      ) {
        return 'reconnect';
      }

      return 'call_local';

    case 'tool_error':
    case 'is_error':
    case 'invalid_output':
    case 'timeout':
    case 'cancelled':
      return 'call_local';

    default:
      return 'reconnect';
  }
}
