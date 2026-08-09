export type ToolTerminationStatus = 'cancelled' | 'expired' | 'failed';

const MESSAGES: Record<ToolTerminationStatus, string> = {
  cancelled: 'The run was cancelled before this tool finished.',
  expired: 'The run expired before this tool finished.',
  failed: 'The run failed before this tool finished.',
};

export function toolTerminationMessage(status: ToolTerminationStatus): string {
  return MESSAGES[status];
}
