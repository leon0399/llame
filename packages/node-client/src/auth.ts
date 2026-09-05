import { createHash } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { privateDirectory, readPrivate, writePrivate, withPrivateLock } from '@workspace/personal-node/private-files';
import { authority, keys, parseJson, record, text, uuid } from '@workspace/personal-node/validation';
import { request, readJson } from '@workspace/personal-node/http';
import { CliError } from '@workspace/personal-node/errors';
import { type ClientOutput } from './types';

export interface Credential {
  readonly authority: string;
  readonly token: string;
  readonly userId: string;
  readonly source: 'file' | 'environment';
}

export interface SessionMaterial {
  readonly authority: string;
  readonly token: string;
  readonly expectedUserId?: string;
  readonly source: 'file' | 'environment';
}

export class Auth {
  readonly remote: string;
  private readonly file: string;
  constructor(remote: string, directory: string, private readonly output: ClientOutput) {
    this.remote = authority(remote);
    const authDirectory = privateDirectory(join(privateDirectory(directory), 'auth'));
    this.file = join(authDirectory, `${createHash('sha256').update(this.remote).digest('hex')}.json`);
  }

  async login(email: string, password: string, signal: AbortSignal): Promise<Credential> {
    this.ensureNotStored(); this.output.protect([password]);
    const response = await request(`${this.remote}/auth/v1/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    }, signal);
    const result = record(await readJson(response), 'login response');
    const token = text(result.token, 'session token', 4096); this.output.protect([token]);
    return this.save(await this.identify(token, signal));
  }

  async importToken(token: string, signal: AbortSignal): Promise<Credential> {
    this.ensureNotStored();
    return this.save(await this.identify(text(token, 'session token', 4096), signal));
  }

  session(env: NodeJS.ProcessEnv): SessionMaterial {
    if (env.LLAME_TOKEN) {
      if (!env.LLAME_TOKEN_FOR || authority(env.LLAME_TOKEN_FOR) !== this.remote) {
        throw new CliError('token_authority', 'Set LLAME_TOKEN_FOR to the exact --remote authority before using LLAME_TOKEN.');
      }
      this.output.protect([env.LLAME_TOKEN]);
      return { authority: this.remote, token: text(env.LLAME_TOKEN, 'session token', 4096), source: 'environment' };
    }
    if (!existsSync(this.file)) throw new CliError('login_required', 'No credential for this authority. Use auth login or auth import --token-stdin.');
    const stored = record(parseJson(readPrivate(this.file, 16_384)), 'credential');
    keys(stored, ['version', 'authority', 'token', 'userId'], 'credential');
    if (stored.version !== 1 || stored.authority !== this.remote) throw new CliError('credential_authority', 'Credential version or authority mismatch.');
    const token = text(stored.token, 'session token', 4096);
    this.output.protect([token]);
    return { authority: this.remote, token, expectedUserId: uuid(stored.userId), source: 'file' };
  }

  async credential(env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<Credential> {
    const material = this.session(env);
    const current = await this.identify(material.token, signal);
    if (material.expectedUserId && current.userId !== material.expectedUserId) {
      throw new CliError('account_changed', 'Session account does not match the stored account.');
    }
    return { ...current, source: material.source };
  }

  private async identify(token: string, signal: AbortSignal): Promise<Credential> {
    this.output.protect([token]);
    if (/\s/.test(token)) throw new CliError('invalid_token', 'Session token must not contain whitespace.');
    const response = await request(`${this.remote}/auth/v1/me`, { headers: { authorization: `Bearer ${token}` } }, signal);
    const user = record(await readJson(response), 'current user');
    return { authority: this.remote, token, userId: uuid(user.id), source: 'environment' };
  }

  private save(credential: Credential): Credential {
    withPrivateLock(this.file, () => writePrivate(this.file, JSON.stringify({ version: 1, authority: this.remote, token: credential.token, userId: credential.userId }) + '\n', false));
    return { ...credential, source: 'file' };
  }
  private ensureNotStored(): void {
    if (existsSync(this.file)) throw new CliError('already_logged_in', 'A credential already exists for this authority. Log out (revoke) or explicitly forget it before another login.');
  }

  async logout(credential: SessionMaterial, signal: AbortSignal): Promise<void> {
    try {
      const response = await request(`${this.remote}/auth/v1/sessions/current`, {
        method: 'DELETE', headers: { authorization: `Bearer ${credential.token}` },
      }, signal);
      await response.body?.cancel();
    } catch (error) {
      // Expired/already-revoked is also safely logged out; other failures keep
      // the credential available for a future revocation attempt.
      if (!(error instanceof CliError && error.code === 'http_401')) throw error;
    }
    if (credential.source === 'file') withPrivateLock(this.file, () => {
      if (!existsSync(this.file)) return;
      const current = this.session({});
      if (current.token !== credential.token || current.expectedUserId !== credential.expectedUserId) {
        throw new CliError('credential_changed', 'The old remote session was revoked, but a newer local login exists and was retained.');
      }
      unlinkSync(this.file);
    });
  }

  forget(): void {
    withPrivateLock(this.file, () => {
      if (existsSync(this.file)) { readPrivate(this.file, 16_384); unlinkSync(this.file); }
    });
  }
}
