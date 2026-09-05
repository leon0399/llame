import { type RuntimeOutput } from '@workspace/personal-node/output';
import { type UnknownRecord } from '@workspace/runtime-safety';

/** A renderer is supplied by the Surface, never constructed by the client. */
export interface ClientOutput extends RuntimeOutput { value(value: unknown): void }
export interface LocalConnectionOptions {
  readonly data: string; readonly config: string; readonly cwd: string; readonly native: boolean;
}
export interface NodeConnection {
  call(method: string, params: UnknownRecord, signal: AbortSignal): Promise<unknown>;
}
