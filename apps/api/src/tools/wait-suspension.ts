import { type ToolResult } from '@workspace/runtime-safety';

export type WaitRequest = {
  readonly toolCallId: string;
  readonly toolInput: {
    readonly jobs: Array<string>;
    readonly timeout?: number;
  };
  readonly jobIds: Array<string>;
  readonly deadline: string;
};

/** Private control-flow identity; never persist, render, or dispatch this value. */
export const WAIT_SUSPENSION: ToolResult = Object.freeze({
  status: 'success',
});
