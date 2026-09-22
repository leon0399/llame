import { type UnknownRecord } from "./unknown-record";

/** Structured bounded observation shared by the server and personal runtime. */
export type ToolResult =
  | ({ status: "success" } & UnknownRecord)
  | {
      status: "error";
      type: string;
      message: string;
      /**
       * A refused derived locator's origin and path, bounded and stripped of
       * control characters — never inside `message`, which stays a fixed
       * template (web-read design D3). Absent on every other error.
       */
      rejectedUrl?: string;
    };
