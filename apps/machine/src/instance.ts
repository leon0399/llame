import { randomUUID } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { machineConfigDir } from "./env";

const INSTANCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const INSTANCE_FILE_MODE = 0o600;
const CONFIG_DIR_MODE = 0o700;

type InstanceDocument = { readonly instanceId: string };

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isInstanceDocument(value: unknown): value is InstanceDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    "instanceId" in value &&
    isString(value.instanceId)
  );
}

/** The file that binds this Machine's name to one identity. */
export function instanceFileFor(
  configDir: string = machineConfigDir(),
): string {
  return join(configDir, "instance.json");
}

function corruptMessage(file: string): string {
  return `The instance file ${file} is unreadable or corrupt; restore it or delete it to create a new instance id.`;
}

/** The persisted id, or undefined when no file exists yet. */
function readInstanceId(file: string): string | undefined {
  let text: string;

  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;

    throw new Error(corruptMessage(file), { cause: error });
  }

  let document: unknown;

  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new Error(corruptMessage(file), { cause: error });
  }

  if (
    !isInstanceDocument(document) ||
    !INSTANCE_ID_PATTERN.test(document.instanceId)
  )
    throw new Error(corruptMessage(file));

  return document.instanceId;
}

/**
 * Writes `instanceId` as this Machine's instance unless another process won
 * the race, and returns the id that is actually on disk. The hard link is the
 * publication step: an existing file is never replaced, so two daemons that
 * start together still report one identity.
 */
export function createInstanceFile(
  configDir: string,
  instanceId: string = randomUUID(),
): string {
  const file = instanceFileFor(configDir);
  const temp = `${file}.${String(process.pid)}.${randomUUID()}.tmp`;

  mkdirSync(configDir, { recursive: true, mode: CONFIG_DIR_MODE });

  try {
    writeFileSync(temp, `${JSON.stringify({ instanceId })}\n`, {
      mode: INSTANCE_FILE_MODE,
    });

    try {
      linkSync(temp, file);
    } catch (error) {
      // Another process linked its file first; its id is the winner's.
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }
  } finally {
    rmSync(temp, { force: true });
  }

  const created = readInstanceId(file);

  if (created === undefined) throw new Error(corruptMessage(file));

  return created;
}

/**
 * This Machine's persistent identity. The first process to run here creates
 * it; every later session reads the same id, which is what lets the hub bind
 * a Machine name to one box and refuse a name that answers differently.
 */
export function readOrCreateInstanceId(configDir: string): string {
  const existing = readInstanceId(instanceFileFor(configDir));

  return existing ?? createInstanceFile(configDir);
}
