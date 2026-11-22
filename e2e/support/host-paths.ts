/**
 * Host paths the browser fixtures address through the api's own Machine.
 *
 * A `read` on a bare absolute path runs on the local Machine, and its daemon
 * refuses every path outside its registered roots (`path_not_registered`).
 * The e2e harness therefore registers {@link E2E_HOST_ROOTS} on that Machine
 * (playwright.config.ts passes them to apps/api/scripts/dev-machine-host.mts),
 * and every scripted host path must stay inside one of them.
 */

/** The file permission-gate.spec.ts reads after a rejected Bash call. */
export const E2E_HOST_READ_PATH = "/etc/hostname";

/** The Machine roots every fixture host path resolves inside. */
export const E2E_HOST_ROOTS: ReadonlyArray<string> = ["/etc"];
