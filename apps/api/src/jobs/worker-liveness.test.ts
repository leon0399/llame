import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { workerDeadAfterSeconds } from './worker-liveness';

describe('workerDeadAfterSeconds', () => {
  it('is four heartbeat intervals', () => {
    const config = {
      ...BUILT_IN_DEFAULTS,
      runs: { ...BUILT_IN_DEFAULTS.runs, heartbeatSeconds: 20 },
    };

    expect(workerDeadAfterSeconds(config)).toBe(80);
  });
});
