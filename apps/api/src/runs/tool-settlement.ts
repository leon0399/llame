export type ToolTerminationStatus = 'cancelled' | 'expired' | 'failed';

const MESSAGES = {
  cancelled: 'The run was cancelled before this tool finished.',
  expired: 'The run expired before this tool finished.',
  failed: 'The run failed before this tool finished.',
} satisfies Record<ToolTerminationStatus, string>;

export function toolTerminationMessage(status: ToolTerminationStatus): string {
  return MESSAGES[status];
}
