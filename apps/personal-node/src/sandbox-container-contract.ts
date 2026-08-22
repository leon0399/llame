import { createHash } from "node:crypto";
import { isAbsolute, normalize } from "node:path";

import { WRITER_STREAM_ID_PATTERN } from "@workspace/federation-experiment";

const CONTENT_ADDRESSED_IMAGE_PATTERN =
  /^(?:[a-z0-9][a-z0-9._:/-]*@)?sha256:[a-f0-9]{64}$/;
const NUMERIC_NON_ROOT_USER_PATTERN = /^[1-9][0-9]*:[1-9][0-9]*$/;
const MOUNT_UNSAFE_PATTERN = /[,\0\r\n]/;
const COMMAND_UNSAFE_PATTERN = /\0/;
const MAX_SANDBOX_COMMAND_ARGUMENTS = 128;
const MAX_SANDBOX_COMMAND_COMPONENT_BYTES = 8192;
const MAX_SANDBOX_COMMAND_BYTES = 64 * 1024;

export function isContentAddressedSandboxImage(image: string): boolean {
  return CONTENT_ADDRESSED_IMAGE_PATTERN.test(image);
}

export function isNumericNonRootSandboxUser(user: string): boolean {
  return NUMERIC_NON_ROOT_USER_PATTERN.test(user);
}

export interface DockerSandboxPlanInput {
  readonly nodeId: string;
  readonly runId: string;
  readonly image: string;
  readonly workspaceSourceRealpath: string;
  readonly user: string;
}

export interface DockerSandboxPlan {
  readonly nodeId: string;
  readonly runId: string;
  readonly containerName: string;
  readonly workspaceTarget: "/workspace";
  readonly homeVolumeName: string;
  readonly image: string;
  readonly workspaceSourceRealpath: string;
  readonly user: string;
  readonly security: DockerSandboxSecurityContract;
  readonly createArguments: readonly string[];
}

export interface SandboxCommandRequest {
  readonly command: string;
  readonly args: readonly string[];
}

export interface DockerSandboxSecurityContract {
  readonly networkMode: "none";
  readonly ipcMode: "private";
  readonly cgroupNamespace: "private";
  readonly droppedCapabilities: "ALL";
  readonly noNewPrivileges: true;
  readonly readOnlyRoot: true;
  readonly pidsLimit: 512;
}

export function buildDockerSandboxPlan(
  input: DockerSandboxPlanInput,
): DockerSandboxPlan {
  validateIdentity(input.nodeId, "node");
  validateIdentity(input.runId, "Run");
  if (!isContentAddressedSandboxImage(input.image)) {
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
  if (!isNumericNonRootSandboxUser(input.user)) {
    throw new Error("Sandbox user must be a numeric non-root uid:gid");
  }

  const containerName = resourceName("llame", input.nodeId, input.runId);
  const homeVolumeName = resourceName("llame-home", input.nodeId, input.runId);
  return {
    nodeId: input.nodeId,
    runId: input.runId,
    containerName,
    workspaceTarget: "/workspace",
    homeVolumeName,
    image: input.image,
    workspaceSourceRealpath: input.workspaceSourceRealpath,
    user: input.user,
    security: {
      networkMode: "none",
      ipcMode: "private",
      cgroupNamespace: "private",
      droppedCapabilities: "ALL",
      noNewPrivileges: true,
      readOnlyRoot: true,
      pidsLimit: 512,
    },
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

export function buildDockerSandboxCommandArguments(
  plan: DockerSandboxPlan,
  request: SandboxCommandRequest,
): readonly string[] {
  validateSandboxCommandRequest(request);
  return [
    "container",
    "exec",
    "--workdir",
    plan.workspaceTarget,
    "--user",
    plan.user,
    plan.containerName,
    request.command,
    ...request.args,
  ];
}

export function validateSandboxCommandRequest(
  request: SandboxCommandRequest,
): void {
  if (
    request.command.length === 0 ||
    request.args.length > MAX_SANDBOX_COMMAND_ARGUMENTS
  ) {
    throw new Error("invalid Sandbox command");
  }
  const components = [request.command, ...request.args];
  if (
    components.some(
      (component) =>
        COMMAND_UNSAFE_PATTERN.test(component) ||
        Buffer.byteLength(component) > MAX_SANDBOX_COMMAND_COMPONENT_BYTES,
    ) ||
    components.reduce(
      (bytes, component) => bytes + Buffer.byteLength(component),
      0,
    ) > MAX_SANDBOX_COMMAND_BYTES
  ) {
    throw new Error("invalid Sandbox command");
  }
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
