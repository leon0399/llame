import { renderBashText } from "./model-text";

describe("bash text rendering", () => {
  const success = {
    status: "success" as const,
    exitCode: 0,
    stdout: "",
    stderr: "",
    truncated: false,
  };

  it("renders a silent command as its status header and no output", () => {
    // `true` exits 0 after 12 ms: one decimal, so 0.0 s.
    expect(renderBashText({ ...success, wallTimeMs: 12 })).toBe(
      "exit 0, 0.0 s\n(no output)",
    );
  });

  it("labels a non-empty stderr after the stdout", () => {
    expect(
      renderBashText({ ...success, stdout: "out\n", stderr: "warn\n" }),
    ).toBe("exit 0\nout\n[stderr]\nwarn");
  });

  it("reports only the stderr when the stdout is empty", () => {
    expect(renderBashText({ ...success, stderr: "problem" })).toBe(
      "exit 0\n[stderr]\nproblem",
    );
  });

  it("renders a stored result without a wall time as the bare header", () => {
    expect(renderBashText(success)).toBe("exit 0\n(no output)");
  });

  it("marks a cut output after its streams", () => {
    expect(
      renderBashText({
        ...success,
        exitCode: 2,
        wallTimeMs: 1240,
        stdout: "prefix",
        truncated: true,
      }),
    ).toBe("exit 2, 1.2 s\nprefix\n[output cut at the bound]");
  });

  it("ends with the cap notice in brackets", () => {
    expect(
      renderBashText({
        ...success,
        stdout: "kept",
        truncationNotice: "Result truncated to fit the cap.",
      }),
    ).toBe("exit 0\nkept\n[Result truncated to fit the cap.]");
  });

  it("renders a failure with its non-zero code in the same shape", () => {
    expect(
      renderBashText({
        status: "error",
        exitCode: 1,
        wallTimeMs: 24_600,
        stdout: "",
        stderr: "",
        truncated: false,
      }),
    ).toBe("exit 1, 24.6 s\n(no output)");
  });
});
