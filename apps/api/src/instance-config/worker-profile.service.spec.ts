/**
 * WorkerProfileService unit tests (durable-run-workers D2/D4, task 7.5):
 * profile routing — a profile with a SUBSET of groups makes only those
 * groups' concurrency resolvable; `all` resolves every group; an unknown
 * `LLAME_WORKER_PROFILE` fails closed at construction (which aborts Nest
 * bootstrap, same posture as InstanceConfigService's own config errors).
 * Pure DI unit test — no queue, no database.
 */
import { InstanceConfigError } from './instance-config.error';
import { type InstanceConfigService } from './instance-config.service';
import { BUILT_IN_DEFAULTS, type WorkerProfile } from './llame-config';
import { WorkerProfileService } from './worker-profile.service';

const ENV_KEY = 'LLAME_WORKER_PROFILE';

let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalEnv;
});

function fakeInstanceConfig(
  workers: Record<string, WorkerProfile>,
): InstanceConfigService {
  return {
    config: { workers },
  } as unknown as InstanceConfigService;
}

describe('WorkerProfileService — profile resolution', () => {
  it('defaults to the `all` profile when LLAME_WORKER_PROFILE is unset', () => {
    const service = new WorkerProfileService(
      fakeInstanceConfig(BUILT_IN_DEFAULTS.workers),
    );
    expect(service.profileName).toBe('all');
  });

  it("`all` resolves every group's concurrency (today's co-located behavior)", () => {
    const service = new WorkerProfileService(
      fakeInstanceConfig(BUILT_IN_DEFAULTS.workers),
    );
    expect(service.concurrencyFor('runs')).toBe(1);
    expect(service.concurrencyFor('search-reindex')).toBe(1);
    expect(service.concurrencyFor('sessions-cleanup')).toBe(1);
  });

  it('`web` (empty profile) resolves every group to null — no consumer registers anything', () => {
    process.env[ENV_KEY] = 'web';
    const service = new WorkerProfileService(
      fakeInstanceConfig(BUILT_IN_DEFAULTS.workers),
    );
    expect(service.concurrencyFor('runs')).toBeNull();
    expect(service.concurrencyFor('search-reindex')).toBeNull();
    expect(service.concurrencyFor('sessions-cleanup')).toBeNull();
  });

  it('a profile with a SUBSET of groups resolves only those — the rest are null (taint routing)', () => {
    process.env[ENV_KEY] = 'heavy';
    const service = new WorkerProfileService(
      fakeInstanceConfig({ ...BUILT_IN_DEFAULTS.workers, heavy: { runs: 3 } }),
    );
    expect(service.concurrencyFor('runs')).toBe(3);
    expect(service.concurrencyFor('search-reindex')).toBeNull();
    expect(service.concurrencyFor('sessions-cleanup')).toBeNull();
  });

  it('fails closed when LLAME_WORKER_PROFILE names a profile absent from the workers map', () => {
    process.env[ENV_KEY] = 'nonexistent';
    expect(
      () =>
        new WorkerProfileService(fakeInstanceConfig(BUILT_IN_DEFAULTS.workers)),
    ).toThrow(InstanceConfigError);
    expect(
      () =>
        new WorkerProfileService(fakeInstanceConfig(BUILT_IN_DEFAULTS.workers)),
    ).toThrow(/nonexistent/);
  });

  it('an empty/blank-string LLAME_WORKER_PROFILE falls back to the default `all`, not to an empty profile name', () => {
    process.env[ENV_KEY] = '   ';
    const service = new WorkerProfileService(
      fakeInstanceConfig(BUILT_IN_DEFAULTS.workers),
    );
    expect(service.profileName).toBe('all');
  });
});
