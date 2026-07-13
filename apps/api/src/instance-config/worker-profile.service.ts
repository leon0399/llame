import { Injectable, Logger } from '@nestjs/common';

import { InstanceConfigError } from './instance-config.error';
import { InstanceConfigService } from './instance-config.service';
import { type WorkerGroup } from './llame-config';

/** Env var selecting the active worker profile; default `all` (every group, concurrency 1 — today's co-located behavior). */
const WORKER_PROFILE_ENV = 'LLAME_WORKER_PROFILE';
const DEFAULT_PROFILE = 'all';

/**
 * WorkerProfileService (durable-run-workers D2/D4) — resolves the active
 * worker profile once at boot: which consumer groups THIS process registers,
 * and each one's main-queue concurrency. Both `main.ts` (co-located api) and
 * `worker.ts` (dedicated worker) share this same resolver — there is no
 * separate co-location toggle (no `RUN_EXECUTION_MODE`); co-located dev is
 * simply the default `all` profile applied to the api process.
 *
 * Fail-closed at boot (constructor throws, same pattern as
 * InstanceConfigService): `LLAME_WORKER_PROFILE` naming a profile absent from
 * the configured `workers` map is a misconfiguration that must never
 * silently run zero consumers for a group nobody else covers.
 */
@Injectable()
export class WorkerProfileService {
  private readonly logger = new Logger(WorkerProfileService.name);
  readonly profileName: string;
  private readonly groups: Readonly<Partial<Record<WorkerGroup, number>>>;

  constructor(instanceConfig: InstanceConfigService) {
    const requested = process.env[WORKER_PROFILE_ENV]?.trim();
    this.profileName =
      requested && requested.length > 0 ? requested : DEFAULT_PROFILE;

    const profile = instanceConfig.config.workers[this.profileName];
    if (!profile) {
      const known = Object.keys(instanceConfig.config.workers).join(', ');
      throw new InstanceConfigError(
        `${WORKER_PROFILE_ENV}="${this.profileName}" names a worker profile that does not exist in the configured "workers" map (known profiles: ${known || '(none)'}). Every deployed process must resolve to a real profile — a typo here would otherwise silently run zero consumers.`,
      );
    }
    this.groups = profile;
    this.logger.log(
      `Active worker profile "${this.profileName}": ${JSON.stringify(this.groups)}`,
    );
  }

  /**
   * Main-queue concurrency for `group` if it is active in this process's
   * profile, else `null` — the gate every consumer-owning service checks in
   * its `onApplicationBootstrap`: `null` means register NOTHING for that
   * group (not even at concurrency 1).
   */
  concurrencyFor(group: WorkerGroup): number | null {
    return this.groups[group] ?? null;
  }
}
