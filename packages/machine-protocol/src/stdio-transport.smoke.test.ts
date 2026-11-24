import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@connectrpc/connect";
import { BootstrapService } from "./generated/stead/machine/bootstrap/v1/bootstrap_pb";
import { MachineService } from "./generated/stead/machine/v1/machine_pb";
import { MACHINE_PROTOCOL_VERSION } from "./protocol-version";
import { connectStdio, type StdioConnection } from "./stdio-transport";
import { daemonBinary } from "./daemon-binary";

/*
 * The Connect-ES transport against the real Rust daemon over `attach --stdio`:
 * the transport check that gates the TypeScript client. Behavior tests live in
 * `apps/machine/tests`.
 */
describe("Connect-ES over attach --stdio", () => {
  let home: string;
  let connection: StdioConnection;

  beforeAll(() => {
    if (!existsSync(daemonBinary()))
      throw new Error(`Build the daemon first: ${daemonBinary()} is missing.`);
    home = mkdtempSync(join(tmpdir(), "machine-smoke-"));
    mkdirSync(join(home, "root"));
    connection = connectStdio({
      command: daemonBinary(),
      args: ["attach", "--stdio"],
      env: {
        ...process.env,
        LLAME_MACHINE_CONFIG_DIR: join(home, "config"),
        LLAME_MACHINE_STATE_DIR: join(home, "state"),
      },
    });
  });

  afterAll(() => {
    connection.close();
    const lock = join(home, "state", "daemon.lock");
    if (existsSync(lock)) process.kill(Number(readFileSync(lock, "utf8")), "SIGTERM");
    rmSync(home, { recursive: true, force: true });
  });

  it("answers the bootstrap and a main-service unary call", async () => {
    const info = await createClient(BootstrapService, connection.transport).getInfo({});

    expect(info.protocolVersion).toBe(MACHINE_PROTOCOL_VERSION);
    expect(info.instanceId).toMatch(/^[0-9a-f-]{36}$/u);
    const roots = await createClient(MachineService, connection.transport).listRoots({});

    expect(roots.roots).toEqual([]);
  });

  it("records the same protocol version as proto/protocol.json", () => {
    const recorded = JSON.parse(
      readFileSync(join(__dirname, "../proto/protocol.json"), "utf8"),
    ) as { version: number };

    expect(recorded.version).toBe(MACHINE_PROTOCOL_VERSION);
  });
});
