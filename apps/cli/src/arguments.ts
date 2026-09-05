import { isString } from '@workspace/runtime-safety';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { defaultPaths } from '@workspace/personal-node/env';
import { configDocument, remoteConfiguration } from '@workspace/personal-node/config';
import { CliError } from '@workspace/personal-node/errors';
import { authority, uuid } from '@workspace/personal-node/validation';

export interface Options {
  readonly positionals: string[];
  readonly config: string;
  readonly data: string;
  readonly cwd: string;
  readonly remote?: string;
  readonly modeSource: 'flag' | 'config' | 'default';
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
    if (isString(result) && result.length === 0) throw new CliError('arguments', 'Option values must not be empty.');
    return isString(result) ? result : undefined;
  };
  const flag = (name: string) => parsed.values[name] === true;
  if (flag('local') && value('remote')) throw new CliError('mode_conflict', 'Choose --local or --remote, not both.');

  validateCommandFlags(parsed.positionals, value, flag);
  const defaults = defaultPaths(env);
  const config = resolve(value('config') || defaults.config);
  // Explicit flags, help and configuration repair do not depend on a readable
  // default configuration. A normal invocation fails closed on malformed config.
  const direct = flag('local') || value('remote') !== undefined;
  const bypass = direct || flag('help') || flag('version') || ['config', 'remote', 'node'].includes(parsed.positionals[0] ?? '');
  const saved = bypass ? { enabled: false } : remoteConfiguration(configDocument(config));
  const remote = value('remote') ? authority(value('remote')!) : saved.enabled ? saved.url : undefined;
  if (remote && (flag('native') || value('cwd'))) throw new CliError('mode_conflict', 'Remote execution cannot receive local Workspace grants. Use --local to override the saved remote.');
  if (!remote && value('effort')) throw new CliError('mode_conflict', '--effort is supported only by remote execution.');
  const after = value('after') === undefined ? undefined : Number(value('after'));
  if (after !== undefined && (!Number.isSafeInteger(after) || after < 0)) throw new CliError('cursor', '--after must be a nonnegative integer.');
  return { positionals: flag('version') ? ['version'] : parsed.positionals,
    config, data: resolve(value('data-dir') || defaults.data),
    cwd: resolve(value('cwd') || process.cwd()), remote, modeSource: direct ? 'flag' : saved.enabled ? 'config' : 'default',
    model: value('model'), chat: value('chat') ? uuid(value('chat')) : undefined,
    effort: value('effort'), after, email: value('email'), native: flag('native'), json: flag('json'),
    passwordStdin: flag('password-stdin'), tokenStdin: flag('token-stdin'), help: flag('help') };
}

export const help = `llame — local personal runtime or remote durable-run client

Usage:
  llame [--local] [--native] [--model ID] [--chat UUID]
  llame [options] run "prompt"          One turn; '-' reads standard input
  llame remote enable [URL]           Save the default remote (no login or upload)
  llame remote disable                Use local by default; retain saved login
  llame remote status                 Inspect saved connection settings
  llame node serve                   Serve a persistent private local Node (foreground)
  llame node status | node recover    Inspect Node or remove a proven-dead endpoint
  llame config init                   Create a private local config, no overwrite
  llame knowledge list [CURSOR] | knowledge show UUID
  llame --local knowledge create NAME | knowledge search QUERY
  llame --local knowledge read UUID PATH [OFFSET] [LIMIT]
  llame --local mcp list | mcp enable/disable ID | mcp tools [ID]
  llame models                        List configured/available models
  llame chats list | chats show UUID | chats search QUERY   Inspect chat history
  llame --local runs list | runs follow UUID [--after N]
  llame runs show UUID                Inspect a run and its execution snapshot
  llame runs events UUID [--after N]   Replay local events or follow remote events
  llame runs receipt UUID | runs tools UUID             Inspect bound tools or full context (local/remote)
  llame runs cancel UUID              Request cancellation at the owning Node
  llame runs attach CHAT_UUID         Attach to the chat's active remote run
  llame recover                       Recover interrupted local runs, never replay actions
  llame status                        Show mode and local node identity

Remote authentication (saved remote, even disabled, or one-off --remote URL):
  llame --remote URL auth login --email EMAIL [--password-stdin]
  llame --remote URL auth import --token-stdin
  llame --remote URL auth status
  llame --remote URL auth logout       Revoke the remote session, then remove it locally
  llame --remote URL auth forget       Remove locally only; DOES NOT revoke remotely

Options:
  --config FILE   User JSON config (default: XDG_CONFIG_HOME/llame/cli.json)
  --data-dir DIR Private state (default: XDG_DATA_HOME/llame)
  --cwd DIR      Advertised local startup Workspace; only used with --native
  --native       Explicit native Workspace placement, NOT an OS/network sandbox.
                 Writes and processes still require individual terminal approval.
  --remote URL   Override the saved remote for one invocation; does not save it.
  --local        One-invocation standalone override, even with an enabled remote.
  --model ID     Select a local configuration ID or a remote model ID
  --effort VALUE Remote provider effort token, validated by the server
  --chat UUID    Continue that chat, otherwise a fresh chat is created
  --json         Newline-delimited JSON on stdout; diagnostics/prompts on stderr

Interactive: /help, /new, /model ID, /history, /exit.
Local commands use the private Node service (auto-launched when absent).
Ctrl-C cancels local work. A disconnected remote run continues; use runs cancel.
No provider/model downloads, telemetry, automatic remote fallback, or Node enrollment.
`;

function validateCommandFlags(positionals: string[], value: (name: string) => string | undefined, flag: (name: string) => boolean): void {
  const login = positionals[0] === 'auth' && positionals[1] === 'login';
  const tokenImport = positionals[0] === 'auth' && positionals[1] === 'import';
  if ((flag('password-stdin') || value('email')) && !login) throw new CliError('arguments', 'Password/email options apply only to auth login.');
  if (flag('token-stdin') && !tokenImport) throw new CliError('arguments', '--token-stdin applies only to auth import.');
  if (value('after') && !(positionals[0] === 'runs' && ['events', 'follow'].includes(positionals[1] ?? ''))) throw new CliError('arguments', '--after applies only to runs events.');
}
