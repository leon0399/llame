import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import {
  chatJobStates,
  chatJobStoppers,
  type ChatJob,
  type ChatJobState,
  type ChatJobStopper,
} from '../../db/schema';
import { formatJobLocator, jobArtifactLocatorOf } from '../../jobs/job-locator';

/** The one state a `PATCH` may set: a stop request. */
export const CHANGEABLE_JOB_STATES = ['cancelled'] as const;

export type ChangeableJobState = (typeof CHANGEABLE_JOB_STATES)[number];

export class ChangeChatJobDto {
  @ApiProperty({
    enum: CHANGEABLE_JOB_STATES,
    description:
      'The new state of the job. `cancelled` requests a stop with the ' +
      'stopper `owner`.',
  })
  @IsIn(CHANGEABLE_JOB_STATES)
  state!: ChangeableJobState;
}

export class ChatJobResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  chatId!: string;

  @ApiProperty({ example: 'job://bash-4' })
  locator!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Running the test suite',
    description:
      'The intent the model gave the tool call that started the job; null ' +
      'when that call carried none.',
  })
  intent!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'pnpm --filter api test',
    description:
      'The shell text the job runs; null for a job recorded without one.',
  })
  command!: string | null;

  @ApiProperty({ example: 'bash' })
  executor!: string;

  @ApiProperty({ enum: chatJobStates })
  state!: ChatJobState;

  @ApiProperty({
    enum: chatJobStoppers,
    nullable: true,
    description: 'Who stopped a `cancelled` job.',
  })
  stoppedBy!: ChatJobStopper | null;

  @ApiProperty({ format: 'date-time' })
  startedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  settledAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  stopRequestedAt!: Date | null;

  @ApiProperty({ enum: chatJobStoppers, nullable: true })
  stopRequestedBy!: ChatJobStopper | null;

  @ApiProperty({ type: [String], description: 'The names of the outputs.' })
  outputs!: Array<string>;

  @ApiProperty({
    type: [String],
    description: 'The names of the outputs cut by their byte bound.',
  })
  truncated!: Array<string>;

  @ApiProperty({ type: Number, nullable: true })
  exitCode!: number | null;

  @ApiProperty({ type: String, nullable: true })
  signal!: string | null;

  @ApiProperty({
    description:
      'True when the worker of the job stopped; the outcome is unknown.',
  })
  outcomeUnknown!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The artifact locator, when the output is stored as one.',
  })
  artifact!: string | null;
}

export class ChatJobsResponse {
  @ApiProperty({
    type: () => [ChatJobResponse],
    description: 'The jobs of the Chat, the live jobs first.',
  })
  items!: Array<ChatJobResponse>;
}

export class ChatJobOutputPart {
  @ApiProperty({ example: 'stdout' })
  name!: string;

  @ApiProperty({ description: 'The stored text of the output.' })
  content!: string;

  @ApiProperty({
    description:
      'True when the stored output is longer than the response bound; ' +
      '`content` then holds its last part.',
  })
  cut!: boolean;
}

export class ChatJobOutputResponse {
  @ApiProperty({
    description:
      'False when the job settled without a stored output, such as a lost job.',
  })
  available!: boolean;

  @ApiProperty({ type: () => [ChatJobOutputPart] })
  outputs!: Array<ChatJobOutputPart>;
}

export function toChatJobResponse(job: ChatJob): ChatJobResponse {
  return {
    id: job.id,
    chatId: job.chatId,
    locator: formatJobLocator(job.kind, job.seq),
    intent: job.intent,
    command: job.command,
    executor: job.kind,
    state: job.state,
    stoppedBy: job.stoppedBy,
    startedAt: job.startedAt,
    settledAt: job.settledAt,
    stopRequestedAt: job.stopRequestedAt,
    stopRequestedBy: job.stopRequestedBy,
    outputs: job.outputs,
    truncated: job.outputs.filter(
      (output) => job.result?.truncated?.[output] === true,
    ),
    exitCode: job.result?.exitCode ?? null,
    signal: job.result?.signal ?? null,
    outcomeUnknown: job.result?.outcomeUnknown === true,
    artifact: jobArtifactLocatorOf(job) ?? null,
  };
}
