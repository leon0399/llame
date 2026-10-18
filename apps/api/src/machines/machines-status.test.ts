import {
  boundMachineRoots,
  boundMachineVersion,
  deriveMachineStatus,
  isMachineFailureReason,
  machineStatusView,
  MACHINE_FAILURE_REASONS,
  MACHINE_ONLINE_WINDOW_MS,
  MACHINE_ROOT_MAX_LENGTH,
  MACHINE_ROOTS_LIMIT,
  MACHINE_VERSION_MAX_LENGTH,
  type MachineStatusRow,
} from './machines-status';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');

function row(overrides: Partial<MachineStatusRow> = {}): MachineStatusRow {
  return {
    name: 'devl',
    firstContactAt: new Date(NOW - 60_000),
    lastContactAt: new Date(NOW - 1000),
    lastFailureAt: null,
    lastFailureReason: null,
    hubProtocolVersion: 1,
    daemonProtocolVersion: 1,
    daemonVersion: '0.0.1',
    roots: ['/srv/app'],
    updatedAt: new Date(NOW - 1000),
    ...overrides,
  };
}

describe('the failure vocabulary', () => {
  it('is exactly the closed set the spec names', () => {
    expect(MACHINE_FAILURE_REASONS).toEqual([
      'unreachable',
      'host_key_mismatch',
      'auth_failed',
      'incompatible_version',
      'session_lost',
    ]);
  });

  it('accepts its own members and nothing else', () => {
    for (const reason of MACHINE_FAILURE_REASONS)
      expect(isMachineFailureReason(reason)).toBe(true);
    expect(isMachineFailureReason('offline')).toBe(false);
    expect(isMachineFailureReason('')).toBe(false);
    expect(isMachineFailureReason(undefined)).toBe(false);
    expect(isMachineFailureReason(7)).toBe(false);
  });
});

describe('deriveMachineStatus', () => {
  it('is offline when the Machine was never contacted', () => {
    expect(deriveMachineStatus(null, null, NOW)).toBe('offline');
  });

  it('is online inside the inactivity window', () => {
    expect(deriveMachineStatus(new Date(NOW - 1000), null, NOW)).toBe('online');
    expect(
      deriveMachineStatus(new Date(NOW - MACHINE_ONLINE_WINDOW_MS), null, NOW),
    ).toBe('online');
  });

  it('is offline once the window passed', () => {
    expect(
      deriveMachineStatus(
        new Date(NOW - MACHINE_ONLINE_WINDOW_MS - 1),
        null,
        NOW,
      ),
    ).toBe('offline');
    expect(deriveMachineStatus(new Date(NOW - 10 * 60_000), null, NOW)).toBe(
      'offline',
    );
  });

  it('is offline when the last failure came after the last contact', () => {
    expect(
      deriveMachineStatus(new Date(NOW - 1000), new Date(NOW - 500), NOW),
    ).toBe('offline');
  });

  it('is online again once a later contact succeeded', () => {
    expect(
      deriveMachineStatus(new Date(NOW - 500), new Date(NOW - 1000), NOW),
    ).toBe('online');
  });

  it('reads a tie as offline', () => {
    expect(deriveMachineStatus(new Date(NOW), new Date(NOW), NOW)).toBe(
      'offline',
    );
  });
});

describe('boundMachineRoots', () => {
  it('keeps absolute paths in order, deduplicated', () => {
    expect(boundMachineRoots(['/srv/app', '/home/me', '/srv/app'])).toEqual([
      '/srv/app',
      '/home/me',
    ]);
  });

  it('drops everything a root cannot be', () => {
    expect(boundMachineRoots(undefined)).toEqual([]);
    expect(boundMachineRoots([])).toEqual([]);
    expect(boundMachineRoots(['relative/path', '', '~/home'])).toEqual([]);
  });

  it('bounds the count and each entry length', () => {
    const many = Array.from(
      { length: MACHINE_ROOTS_LIMIT + 5 },
      (_, i) => `/r/${i}`,
    );
    expect(boundMachineRoots(many)).toHaveLength(MACHINE_ROOTS_LIMIT);
    const long = `/${'x'.repeat(MACHINE_ROOT_MAX_LENGTH * 2)}`;
    expect(boundMachineRoots([long])).toEqual([
      long.slice(0, MACHINE_ROOT_MAX_LENGTH),
    ]);
  });
});

describe('boundMachineVersion', () => {
  it('keeps a usable version and drops an unusable one', () => {
    expect(boundMachineVersion('1.2.3')).toBe('1.2.3');
    expect(boundMachineVersion('  1.2.3  ')).toBe('1.2.3');
    expect(boundMachineVersion(undefined)).toBeUndefined();
    expect(boundMachineVersion('')).toBeUndefined();
    expect(boundMachineVersion('   ')).toBeUndefined();
  });

  it('bounds the length', () => {
    expect(
      boundMachineVersion('v'.repeat(MACHINE_VERSION_MAX_LENGTH * 2)),
    ).toHaveLength(MACHINE_VERSION_MAX_LENGTH);
  });
});

describe('machineStatusView', () => {
  it('reports a configured Machine that was never contacted as offline', () => {
    expect(machineStatusView('gpu', undefined, NOW)).toEqual({
      name: 'gpu',
      status: 'offline',
      lastSeenAt: null,
      failureReason: null,
      hubProtocolVersion: 1,
      daemonProtocolVersion: null,
      daemonVersion: null,
      roots: [],
    });
  });

  it('reports a contacted Machine with its versions and roots', () => {
    expect(machineStatusView('devl', row(), NOW)).toEqual({
      name: 'devl',
      status: 'online',
      lastSeenAt: new Date(NOW - 1000).toISOString(),
      failureReason: null,
      hubProtocolVersion: 1,
      daemonProtocolVersion: 1,
      daemonVersion: '0.0.1',
      roots: ['/srv/app'],
    });
  });

  it('shows the failure reason of an offline Machine', () => {
    const view = machineStatusView(
      'devl',
      row({
        lastContactAt: new Date(NOW - 60_000),
        lastFailureAt: new Date(NOW - 1000),
        lastFailureReason: 'host_key_mismatch',
      }),
      NOW,
    );
    expect(view.status).toBe('offline');
    expect(view.failureReason).toBe('host_key_mismatch');
  });
});
