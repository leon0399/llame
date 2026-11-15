import { type NewChatJob } from '../jobs/chat-jobs.repository';

/**
 * A new running `bash` job row for the chat, as a fixture inserts it. The caller
 * names the owner, the Chat, the number, and the worker; every other field
 * takes the value of a job that has just started.
 */
export function newChatJob(
  fields: Pick<
    NewChatJob,
    'chatId' | 'ownerUserId' | 'seq' | 'workerInstanceId'
  > &
    Partial<NewChatJob>,
): NewChatJob {
  return {
    executor: 'bash',
    runId: crypto.randomUUID(),
    toolCallId: `call-${fields.seq}`,
    outputs: ['stdout', 'stderr'],
    artifactReadable: true,
    settings: { modelId: 'gpt-5.5', permissionMode: 'default' },
    ...fields,
  };
}
