import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  stat,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const argumentsAfterSeparator = process.argv.slice(2);
if (argumentsAfterSeparator[0] === "--") argumentsAfterSeparator.shift();
const [archiveArgument] = argumentsAfterSeparator;
if (argumentsAfterSeparator.length !== 1 || archiveArgument === undefined) {
  throw new Error("Usage: pnpm test:exports -- <absolute-path-ending-in-.tgz>");
}
if (
  !path.isAbsolute(archiveArgument) ||
  path.normalize(archiveArgument) !== archiveArgument ||
  !archiveArgument.endsWith(".tgz")
) {
  throw new Error("Package archive path must be an absolute normalized .tgz.");
}

const archivePath = await realpath(archiveArgument);
assert.equal(
  (await stat(archivePath)).isFile(),
  true,
  "archive must be a file",
);

const temporaryProject = await mkdtemp(
  path.join("/tmp", "storybook-addon-exports-"),
);

try {
  await writeFile(
    path.join(temporaryProject, "package.json"),
    `${JSON.stringify({ name: "export-test-consumer", private: true, type: "module" }, null, 2)}\n`,
  );

  const installed = spawnSync(
    "pnpm",
    [
      "add",
      "--offline",
      "--ignore-workspace",
      "--ignore-scripts",
      "--save-exact",
      archivePath,
    ],
    {
      cwd: temporaryProject,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (installed.error) {
    throw new Error(
      `Unable to start pnpm archive installation: ${installed.error.message}`,
    );
  }
  if (installed.status !== 0) {
    throw new Error(
      `Installing the supplied archive failed:\n${installed.stderr || installed.stdout}`.trim(),
    );
  }

  const verificationScript = path.join(temporaryProject, "verify-exports.mjs");
  await copyFile(
    new URL("./path-containment.mjs", import.meta.url),
    path.join(temporaryProject, "path-containment.mjs"),
  );
  await writeFile(
    verificationScript,
    String.raw`
import assert from "node:assert/strict";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isPathWithin } from "./path-containment.mjs";

const packageName = "storyproof";
const packageRoot = await realpath(
  path.join(process.cwd(), "node_modules", ...packageName.split("/")),
);
const nodeModulesRoot = await realpath(path.join(process.cwd(), "node_modules"));
const distRoot = await realpath(path.join(packageRoot, "dist"));
const packageJson = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8"),
);
const entries = [
  [".", packageName],
  ["./manager", packageName + "/manager"],
  ["./preset", packageName + "/preset"],
  ["./preview", packageName + "/preview"],
];
assert.deepEqual(
  Object.keys(packageJson.exports ?? {}).sort(),
  entries.map(([exportKey]) => exportKey).sort(),
  "package must expose exactly the four public entry points",
);

for (const [exportKey, specifier] of entries) {
  const definition = packageJson.exports?.[exportKey];
  assert.equal(typeof definition?.types, "string", exportKey + " must declare a types target");
  assert.equal(typeof definition?.import, "string", exportKey + " must declare an import target");
  assert.match(definition.types, /^\.\/dist\/.+\.d\.ts$/, exportKey + " declarations must be under dist");
  assert.match(definition.import, /^\.\/dist\/.+\.js$/, exportKey + " runtime must be JavaScript under dist");

  const runtimePath = await realpath(fileURLToPath(import.meta.resolve(specifier)));
  assert.ok(
    isPathWithin(nodeModulesRoot, runtimePath),
    exportKey + " resolved outside the isolated project's node_modules: " + runtimePath,
  );
  assert.ok(
    isPathWithin(packageRoot, runtimePath),
    exportKey + " resolved outside the installed package: " + runtimePath,
  );
  assert.ok(
    isPathWithin(distRoot, runtimePath),
    exportKey + " runtime resolved outside canonical dist: " + runtimePath,
  );
  assert.match(
    runtimePath,
    /\.js$/,
    exportKey + " canonical runtime must be JavaScript: " + runtimePath,
  );
  assert.doesNotMatch(runtimePath, /\.tsx?$/, exportKey + " resolved to raw TypeScript: " + runtimePath);
  const declarationPath = await realpath(path.resolve(packageRoot, definition.types));
  assert.ok(
    isPathWithin(packageRoot, declarationPath),
    exportKey + " declaration resolved outside the installed package: " + declarationPath,
  );
  assert.ok(
    isPathWithin(distRoot, declarationPath),
    exportKey + " declaration resolved outside canonical dist: " + declarationPath,
  );
  assert.equal(
    (await stat(declarationPath)).isFile(),
    true,
    exportKey + " declaration target does not exist",
  );
}

const preset = await import(packageName + "/preset");
const managerEntries = await preset.managerEntries();
const previewEntries = await preset.previewAnnotations();
assert.equal(managerEntries.length, 1, "compiled preset must add one manager entry");
assert.equal(previewEntries.length, 1, "compiled preset must add one preview entry");
assert.equal(
  await realpath(managerEntries[0]),
  await realpath(path.join(packageRoot, "dist", "manager.js")),
  "compiled preset must resolve compiled manager.js",
);
assert.equal(
  await realpath(previewEntries[0]),
  await realpath(path.join(packageRoot, "dist", "preview.js")),
  "compiled preset must resolve compiled preview.js",
);

for (const privateSubpath of ["node", "node/server", "src/node/server"]) {
  assert.throws(
    () => import.meta.resolve(packageName + "/" + privateSubpath),
    undefined,
    "package-private subpath unexpectedly resolves: " + privateSubpath,
  );
}
`,
  );

  const verified = spawnSync(process.execPath, [verificationScript], {
    cwd: temporaryProject,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (verified.error) {
    throw new Error(
      `Unable to start isolated export verification: ${verified.error.message}`,
    );
  }
  if (verified.status !== 0) {
    process.stderr.write(verified.stderr || verified.stdout);
    process.exitCode = verified.status ?? 1;
  }
} finally {
  await rm(temporaryProject, { recursive: true, force: true });
}
