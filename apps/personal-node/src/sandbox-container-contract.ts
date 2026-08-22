import { createHash } from "node:crypto";
import { isAbsolute, normalize } from "node:path";

import { WRITER_STREAM_ID_PATTERN } from "@workspace/federation-experiment";

const CONTENT_ADDRESSED_IMAGE_PATTERN = /^[^\s@]+@sha256:[a-f0-9]{64}$/;
const NUMERIC_NON_ROOT_USER_PATTERN = /^[1-9][0-9]*:[1-9][0-9]*$/;
const MOUNT_UNSAFE_PATTERN = /[,\0\r\n]/;

export interface DockerSandboxPlanInput {
  readonly nodeId: string;
  readonly runId: string;
  readonly image: string;
  readonly workspaceSourceRealpath: string;
  readonly user: string;
}

export interface DockerSandboxPlan {
  readonly containerName: string;
  readonly workspaceTarget: "/workspace";
  readonly homeVolumeName: string;
  readonly createArguments: readonly string[];
}

export function buildDockerSandboxPlan(
  input: DockerSandboxPlanInput,
): DockerSandboxPlan {
  validateIdentity(input.nodeId, "node");
  validateIdentity(input.runId, "Run");
  if (!CONTENT_ADDRESSED_IMAGE_PATTERN.test(input.image)) {
    throw new Error("Sandbox image must use a sha256 digest");
  }
  if (
    input.workspaceSourceRealpath === "/" ||
    !isAbsolute(input.workspaceSourceRealpath) ||
    normalize(input.workspaceSourceRealpath) !==
      input.workspaceSourceRealpath ||
    MOUNT_UNSAFE_PATTERN.test(input.workspaceSourceRealpath)
  ) {
    throw new Error("Sandbox Workspace path must be canonical and absolute");
  }
  if (!NUMERIC_NON_ROOT_USER_PATTERN.test(input.user)) {
    throw new Error("Sandbox user must be a numeric non-root uid:gid");
  }

  const containerName = resourceName("llame", input.nodeId, input.runId);
  const homeVolumeName = resourceName("llame-home", input.nodeId, input.runId);
  return {
    containerName,
    workspaceTarget: "/workspace",
    homeVolumeName,
    createArguments: [
      "create",
      "--name",
      containerName,
      "--label",
      `dev.llame.node-id=${input.nodeId}`,
      "--label",
      `dev.llame.run-id=${input.runId}`,
      "--pull",
      "never",
      "--network",
      "none",
      "--ipc",
      "private",
      "--cgroupns",
      "private",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges=true",
      "--read-only",
      "--init",
      "--pids-limit",
      "512",
      "--user",
      input.user,
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev",
      "--mount",
      `type=bind,src=${input.workspaceSourceRealpath},dst=/workspace`,
      "--mount",
      `type=volume,src=${homeVolumeName},dst=/home/llame`,
      "--workdir",
      "/workspace",
      input.image,
    ],
  };
}

function validateIdentity(value: string, label: string): void {
  if (!WRITER_STREAM_ID_PATTERN.test(value)) {
    throw new Error(`invalid ${label} id`);
  }
}

function resourceName(prefix: string, nodeId: string, runId: string): string {
  const readable = `${prefix}-${nodeId}-${runId}`;
  if (readable.length <= 128) return readable;
  const suffix = createHash("sha256")
    .update(`${nodeId}\0${runId}`)
    .digest("hex")
    .slice(0, 32);
  return `${prefix}-${suffix}`;
}
