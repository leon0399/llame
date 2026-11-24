import { type NewChatJob } from '../jobs/chat-jobs.repository';

/**
 * A new running Machine job row for the Chat. The caller names the owner, the
 * Chat, and sequence; Machine identity defaults to unique test values.
 */
export function newChatJob(
  fields: Pick<
    NewChatJob,
    'chatId' | 'ownerUserId' | 'seq'
  > &
    Partial<NewChatJob>,
): NewChatJob {
  return {
    kind: 'bash',
    runId: crypto.randomUUID(),
    toolCallId: `call-${fields.seq}`,
    machineName: `test-machine-${crypto.randomUUID()}`,
    daemonInstanceId: crypto.randomUUID(),
    daemonJobId: crypto.randomUUID(),
    outputs: ['stdout', 'stderr'],
    artifactReadable: true,
    settings: { selector: 'gpt-5.5', permissionMode: 'default' },
    ...fields,
  };
}
