import { isString } from '@workspace/runtime-safety';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { defaultPaths } from './env';
import { CliError } from './errors';
import { authority, uuid } from './validation';

export interface Options {
  readonly positionals: string[];
  readonly config: string;
  readonly data: string;
  readonly cwd: string;
  readonly remote?: string;
  readonly model?: string;
  readonly chat?: string;
  readonly effort?: string;
  readonly after?: number;
  readonly email?: string;
  readonly native: boolean;
  readonly json: boolean;
  readonly passwordStdin: boolean;
  readonly tokenStdin: boolean;
  readonly help: boolean;
}

export function argumentsFor(argv: string[], env: NodeJS.ProcessEnv): Options {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
      config: { type: 'string' }, 'data-dir': { type: 'string' }, cwd: { type: 'string' },
      remote: { type: 'string' }, local: { type: 'boolean' }, native: { type: 'boolean' },
      model: { type: 'string' }, chat: { type: 'string' }, effort: { type: 'string' }, after: { type: 'string' },
      email: { type: 'string' }, 'password-stdin': { type: 'boolean' }, 'token-stdin': { type: 'boolean' },
      json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
    } });
  } catch { throw new CliError('arguments', 'Invalid arguments. Use --help; passwords and tokens are not accepted as command-line values.'); }
  const value = (name: string) => {
    const result = parsed.values[name];
    return isString(result) ? result : undefined;
  };
  const flag = (name: string) => parsed.values[name] === true;
  if (flag('local') && value('remote')) throw new CliError('mode_conflict', 'Choose --local or --remote, not both.');
  if (value('remote') && (flag('native') || value('cwd') || value('config'))) throw new CliError('mode_conflict', 'Local config, cwd and native tool grants cannot be attached to remote execution.');
  if (!value('remote') && value('effort')) throw new CliError('mode_conflict', '--effort is supported only by remote execution.');
  validateCommandFlags(parsed.positionals, value, flag);
  const defaults = defaultPaths(env);
  const after = value('after') === undefined ? undefined : Number(value('after'));
  if (after !== undefined && (!Number.isSafeInteger(after) || after < 0)) throw new CliError('cursor', '--after must be a nonnegative integer.');
  return { positionals: flag('version') ? ['version'] : parsed.positionals,
    config: resolve(value('config') || defaults.config), data: resolve(value('data-dir') || defaults.data),
    cwd: resolve(value('cwd') || process.cwd()), remote: value('remote') ? authority(value('remote')!) : undefined,
    model: value('model'), chat: value('chat') ? uuid(value('chat')) : undefined,
    effort: value('effort'), after, email: value('email'), native: flag('native'), json: flag('json'),
    passwordStdin: flag('password-stdin'), tokenStdin: flag('token-stdin'), help: flag('help') };
}

export const help = `llame — local personal runtime or remote durable-run client

Usage:
  llame [--local] [--native] [--model ID] [--chat UUID]
  llame [options] run "prompt"          One turn; '-' reads standard input
  llame config init                   Create a private local config, no overwrite
  llame models                        List configured/available models
  llame chats list | chats show UUID   Inspect chat history
  llame runs show UUID                Inspect a run and its execution snapshot
  llame runs events UUID [--after N]   Replay local events or follow remote events
  llame runs receipt UUID             Inspect remote effective-context receipt
  llame runs cancel UUID              Request remote cancellation
  llame runs attach CHAT_UUID         Attach to the chat's active remote run
  llame recover                       Recover interrupted local runs, never replay actions
  llame status                        Show mode and local node identity

Remote authentication (requires --remote https://your-hub.example):
  llame --remote URL auth login --email EMAIL [--password-stdin]
  llame --remote URL auth import --token-stdin
  llame --remote URL auth status
  llame --remote URL auth logout       Revoke the remote session, then remove it locally
  llame --remote URL auth forget       Remove locally only; DOES NOT revoke remotely

Options:
  --config FILE   Local JSON config (default: XDG_CONFIG_HOME/llame/cli.json)
  --data-dir DIR Private state (default: XDG_STATE_HOME/llame)
  --cwd DIR      Advertised local startup Workspace; only used with --native
  --native       Explicit native Workspace placement, NOT an OS/network sandbox.
                 Writes and processes still require individual terminal approval.
  --remote URL   Execute on the remote node. Never uploads local config or files.
  --local        Explicit standalone mode (the default); no Hub/account required.
  --model ID     Select a local configuration ID or a remote model ID
  --effort VALUE Remote provider effort token, validated by the server
  --chat UUID    Continue that chat, otherwise a fresh chat is created
  --json         Newline-delimited JSON on stdout; diagnostics/prompts on stderr

Interactive: /help, /new, /model ID, /history, /exit.
Ctrl-C cancels local work. A disconnected remote run continues; use runs cancel.
No provider/model downloads, telemetry, automatic remote fallback, or Node enrollment.
`;

function validateCommandFlags(positionals: string[], value: (name: string) => string | undefined, flag: (name: string) => boolean): void {
  const login = positionals[0] === 'auth' && positionals[1] === 'login';
  const tokenImport = positionals[0] === 'auth' && positionals[1] === 'import';
  if ((flag('password-stdin') || value('email')) && !login) throw new CliError('arguments', 'Password/email options apply only to auth login.');
  if (flag('token-stdin') && !tokenImport) throw new CliError('arguments', '--token-stdin applies only to auth import.');
  if (value('after') && !(positionals[0] === 'runs' && positionals[1] === 'events')) throw new CliError('arguments', '--after applies only to runs events.');
}
