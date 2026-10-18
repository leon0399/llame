import type {
  JsonValue,
  MachineMethod,
  MachineMethodResults,
  SerializableValue,
} from "@workspace/machine-protocol";
import type { RootGuard } from "./guard";
import type { BashProcesses } from "./processes";

/** Every method the daemon serves on a request stream; the handshake runs on
 *  the control stream and is not one of them. */
export type Operation = Exclude<MachineMethod, "hello">;

export type OperationContext = {
  readonly roots: ReadonlyArray<string>;
  readonly guard: RootGuard;
  readonly processes: BashProcesses;
  /** Aborts on cancellation or when the request's budget runs out. */
  readonly signal: AbortSignal;
  readonly toolCallId: string | undefined;
  /** A mid-stream notification on the request's own stream. */
  readonly notify: (method: string, params: JsonValue) => void;
};

/** One handler per method, each typed with its own params and result. */
export type OperationTable = {
  readonly [M in Operation]: (
    params: SerializableValue,
    context: OperationContext,
  ) => Promise<MachineMethodResults[M]>;
};
