import { type UnknownRecord } from './unknown-record';

/** Structured bounded observation shared by the server and personal runtime. */
export type ToolResult =
  | ({ status: 'success' } & UnknownRecord)
  | { status: 'error'; type: string; message: string };
