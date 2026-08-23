import { mkdtempSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { CliConfigError, loadCliConfig } from "./config";

function tempConfigPath(): string {
  return path.join(
    mkdtempSync(path.join(tmpdir(), "llame-cli-cfg-")),
    "llame.cli.json",
  );
}

describe("loadCliConfig", () => {
  it("fails loud when no model is configured anywhere", () => {
    expect(() => loadCliConfig({}, tempConfigPath())).toThrow(CliConfigError);
  });

  it("reads model/baseUrl/apiKey from the environment", () => {
    const config = loadCliConfig(
      {
        LLAME_MODEL: "test-model",
        LLAME_BASE_URL: "http://localhost:11434/v1",
        LLAME_API_KEY: "sk-test",
      },
      tempConfigPath(),
    );
    expect(config).toEqual({
      model: "test-model",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "sk-test",
    });
  });

  it("gives llame.cli.json precedence over the environment", async () => {
    const configPath = tempConfigPath();
    await fs.writeFile(
      configPath,
      JSON.stringify({ model: "{env:MY_MODEL}", maxSteps: 3 }),
      "utf8",
    );
    const config = loadCliConfig(
      { MY_MODEL: "file-model", LLAME_MODEL: "env-model" },
      configPath,
    );
    expect(config.model).toBe("file-model");
    expect(config.maxSteps).toBe(3);
  });

  it("resolves {env:} secret tokens through the shared interpolator", async () => {
    const configPath = tempConfigPath();
    await fs.writeFile(
      configPath,
      JSON.stringify({
        model: "m",
        apiKey: "{env:LLAME_TEST_KEY}",
        baseUrl: "{env:LLAME_TEST_BASE:-http://fallback}",
      }),
      "utf8",
    );
    const config = loadCliConfig({ LLAME_TEST_KEY: "sk-from-env" }, configPath);
    expect(config.apiKey).toBe("sk-from-env");
    // `:-` fallback applies when the variable is unset OR empty.
    expect(config.baseUrl).toBe("http://fallback");
  });

  it("fails loud naming the variable when a required token is unset", async () => {
    const configPath = tempConfigPath();
    await fs.writeFile(
      configPath,
      JSON.stringify({ model: "m", apiKey: "{env:LLAME_MISSING_KEY}" }),
      "utf8",
    );
    expect(() => loadCliConfig({}, configPath)).toThrow(/LLAME_MISSING_KEY/);
  });
});
