import { StringDecoder } from 'node:string_decoder';
import { createInterface } from 'node:readline/promises';
import { CliError, aborted } from './errors';
import { Output, terminalText } from './output';
import { type Approval } from './types';

export async function readStdin(maxBytes = 80_000, signal?: AbortSignal): Promise<string> {
  if (signal) aborted(signal);
  const onAbort = () => process.stdin.destroy(new CliError('cancelled', 'Input cancelled.', 130));
  signal?.addEventListener('abort', onAbort, { once: true });
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const value of process.stdin) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
      size += chunk.byteLength;
      if (size > maxBytes) throw new CliError('input_limit', 'Standard input exceeds its size limit.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  } finally { signal?.removeEventListener('abort', onAbort); }
}

export async function question(prompt: string, signal: AbortSignal): Promise<string> {
  aborted(signal);
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new CliError('tty_required', 'This operation requires an interactive terminal.');
  const terminal = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  try { return await terminal.question(terminalText(prompt), { signal }); }
  finally { terminal.close(); }
}

export function approvals(output: Output): Approval {
  return async (description, signal) => {
    if (!process.stdin.isTTY || !process.stderr.isTTY) {
      output.notice('Action denied: per-action approval requires a terminal; piped input cannot approve.');
      return false;
    }
    output.notice(description);
    return /^(?:y|yes)$/i.test((await question('Approve this one action? [y/N] ', signal)).trim());
  };
}

/** Raw-mode input has no password echo and never puts the secret in argv. */
export async function password(signal: AbortSignal): Promise<string> {
  aborted(signal);
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new CliError('tty_required', 'Use --password-stdin in a noninteractive process.');
  const wasRaw = process.stdin.isRaw;
  // Disable echo BEFORE advertising readiness. Another process (or a fast
  // paste) can send the password as soon as the prompt reaches the terminal.
  process.stdin.setRawMode(true);
  return new Promise((resolve, reject) => {
    let value = ''; const decoder = new StringDecoder('utf8');
    const cleanup = () => {
      process.stdin.removeListener('data', onData); signal.removeEventListener('abort', onAbort);
      process.stdin.setRawMode(wasRaw); process.stdin.pause(); process.stderr.write('\n');
    };
    const onAbort = () => { cleanup(); reject(new CliError('cancelled', 'Login cancelled.', 130)); };
    const onData = (data: Buffer) => {
      for (const char of decoder.write(data)) {
        if (char === '\x03') { onAbort(); return; }
        if (char === '\r' || char === '\n') { cleanup(); resolve(value); return; }
        if (char === '\x7f' || char === '\b') value = [...value].slice(0, -1).join('');
        else if (char >= ' ' && char !== '\x1b') value += char;
        if (value.length > 256) { cleanup(); reject(new CliError('password_limit', 'Password exceeds the server limit.')); return; }
      }
    };
    process.stdin.on('data', onData); signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    else { process.stderr.write('Password: '); process.stdin.resume(); }
  });
}
