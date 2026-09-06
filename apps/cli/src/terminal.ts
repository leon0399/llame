import { StringDecoder } from "node:string_decoder";
import { createInterface } from "node:readline/promises";
import { CliError, aborted, errorCode } from "@workspace/personal-node/errors";
import { Output } from "./output";
import { terminalText } from "@workspace/personal-node/output";
import { type Approval } from "@workspace/personal-node/types";

function destroyStdinOnAbort(): void {
  process.stdin.destroy(new CliError("cancelled", "Input cancelled.", 130));
}

export async function readStdin(
  maxBytes = 80_000,
  signal?: AbortSignal,
): Promise<string> {
  if (signal) aborted(signal);
  signal?.addEventListener("abort", destroyStdinOnAbort, { once: true });
  const chunks: Array<Buffer> = [];
  let size = 0;
  try {
    for await (const value of process.stdin) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
      size += chunk.byteLength;
      if (size > maxBytes)
        throw new CliError(
          "input_limit",
          "Standard input exceeds its size limit.",
        );
      chunks.push(chunk);
    }
    return Buffer.concat(chunks)
      .toString("utf8")
      .replace(/\r?\n$/, "");
  } finally {
    signal?.removeEventListener("abort", destroyStdinOnAbort);
  }
}

export async function question(
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  aborted(signal);
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new CliError(
      "tty_required",
      "This operation requires an interactive terminal.",
    );
  const terminal = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });
  try {
    return await terminal.question(terminalText(prompt), { signal });
  } catch (error) {
    if (signal.aborted || errorCode(error) === "ABORT_ERR")
      throw new CliError("cancelled", "Input cancelled.", 130);
    throw error;
  } finally {
    terminal.close();
  }
}

export function approvals(output: Output): Approval {
  return async (description, signal) => {
    if (!process.stdin.isTTY || !process.stderr.isTTY) {
      output.notice(
        "Action denied: per-action approval requires a terminal; piped input cannot approve.",
      );
      return false;
    }
    output.notice(description);
    return /^(?:y|yes)$/i.test(
      (await question("Approve this one action? [y/N] ", signal)).trim(),
    );
  };
}

type EscapeState = "none" | "esc" | "csi";

interface PasswordStroke {
  readonly value: string;
  readonly escape: EscapeState;
  readonly done?: "submit" | "cancel";
}

interface PasswordState {
  value: string;
  escape: EscapeState;
}

// Persists across chunks so a CSI sequence split mid-write (e.g. arrow
// keys) is still fully consumed instead of leaking its bytes below.
function nextEscape(escape: EscapeState, char: string): EscapeState {
  if (escape === "csi") {
    const code = char.codePointAt(0) ?? 0;
    return code >= 0x40 && code <= 0x7e ? "none" : "csi";
  }
  if (escape === "esc") return char === "[" ? "csi" : "none";
  return char === "\x1b" ? "esc" : "none";
}

function applyPasswordChar(value: string, char: string): string {
  if (char === "\x7f" || char === "\b") return [...value].slice(0, -1).join("");
  if (char >= " ") return value + char;
  return value;
}

function consumePasswordChar(
  value: string,
  char: string,
  escape: EscapeState,
): PasswordStroke {
  if (escape !== "none") return { value, escape: nextEscape(escape, char) };
  if (char === "\x1b") return { value, escape: "esc" };
  if (char === "\x03") return { value, escape: "none", done: "cancel" };
  if (char === "\r" || char === "\n")
    return { value, escape: "none", done: "submit" };
  return { value: applyPasswordChar(value, char), escape: "none" };
}

function emptyPasswordState(): PasswordState {
  return { value: "", escape: "none" };
}

function attachPasswordInput(
  signal: AbortSignal,
  wasRaw: boolean,
  resolve: (value: string) => void,
  reject: (error: Error) => void,
): void {
  const decoder = new StringDecoder("utf8");
  const state = emptyPasswordState();
  const cleanup = () => {
    process.stdin.removeListener("data", onData);
    signal.removeEventListener("abort", onAbort);
    process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
    process.stderr.write("\n");
  };
  const onAbort = () => {
    cleanup();
    reject(new CliError("cancelled", "Login cancelled.", 130));
  };
  const onData = passwordDataHandler(decoder, state, (action) => {
    if (action === "cancel") return onAbort();
    cleanup();
    if (action === "limit")
      reject(
        new CliError("password_limit", "Password exceeds the server limit."),
      );
    else resolve(state.value);
  });
  process.stdin.on("data", onData);
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  else {
    process.stderr.write("Password: ");
    process.stdin.resume();
  }
}

function passwordDataHandler(
  decoder: StringDecoder,
  state: PasswordState,
  finish: (action: "submit" | "cancel" | "limit") => void,
): (data: Buffer) => void {
  return (data: Buffer) => {
    for (const char of decoder.write(data)) {
      const next = consumePasswordChar(state.value, char, state.escape);
      state.value = next.value;
      state.escape = next.escape;
      if (next.done) {
        finish(next.done);
        return;
      }
      if (state.value.length > 256) {
        finish("limit");
        return;
      }
    }
  };
}

/** Raw-mode input has no password echo and never puts the secret in argv. */
export async function password(signal: AbortSignal): Promise<string> {
  aborted(signal);
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new CliError(
      "tty_required",
      "Use --password-stdin in a noninteractive process.",
    );
  const wasRaw = process.stdin.isRaw;
  // Disable echo BEFORE advertising readiness. Another process (or a fast
  // paste) can send the password as soon as the prompt reaches the terminal.
  process.stdin.setRawMode(true);
  return new Promise((resolve, reject) => {
    attachPasswordInput(signal, wasRaw, resolve, reject);
  });
}
