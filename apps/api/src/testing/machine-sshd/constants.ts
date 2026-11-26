import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The Machine the suite declares, and the alias its SSH route resolves. */
export const MACHINE_SSHD_NAME = 'devl';
export const MACHINE_SSHD_ALIAS = 'box';

/** The box's registered root (added by the static daemon before test startup). */
export const MACHINE_SSHD_ROOT = '/home/box/work';
export const MACHINE_SSHD_NOTES_FILE = `${MACHINE_SSHD_ROOT}/notes.txt`;

/** The root-only read fixtures the image creates (ssh-locator task 4.1). */
export const MACHINE_SSHD_FIXTURE_ROOT = `${MACHINE_SSHD_ROOT}/fixture`;

/** The text the login shell writes before every `ssh://` script runs. */
export const MACHINE_SSHD_LOGIN_NOISE =
  'llame fixture: login shell startup noise';

/** The `sh`-only container's alias: `/bin/sh` and no `bash`. */
export const MACHINE_SSHD_SH_ALIAS = 'shbox';

/** The bytes the suite expects back for that file, read from the same fixture
 *  the image copies, so the expectation cannot drift from the container. */
export const MACHINE_SSHD_NOTES_CONTENT = readFileSync(
  join(__dirname, 'notes.txt'),
  'utf8',
);

