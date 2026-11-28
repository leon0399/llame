/** @param {string} target @param {string} hostTarget @param {NodeJS.ProcessEnv} environment */
export function compilerEnv(target, hostTarget, environment) {
  const key = `CC_${target.replaceAll("-", "_")}`;

  if (
    environment[key] !== undefined ||
    target !== hostTarget ||
    environment.TARGET_CC !== undefined ||
    environment.HOST_CC !== undefined
  ) {
    return {};
  }

  return { [key]: environment.CC ?? "cc" };
}
