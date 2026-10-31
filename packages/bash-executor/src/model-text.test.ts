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

  it("marks the output the executor bound cut after its streams", () => {
    expect(
      renderBashText({
        ...success,
        exitCode: 2,
        wallTimeMs: 1240,
        stdout: "prefix",
        cut: true,
      }),
    ).toBe("exit 2, 1.2 s\nprefix\n[output cut at the bound]");
  });

  it("keeps the bound marker on a cut result the cap also shortened", () => {
    expect(
      renderBashText({
        ...success,
        stdout: "prefix",
        cut: true,
        truncated: true,
        truncationNotice: "Result truncated to fit the cap.",
      }),
    ).toBe(
      "exit 0\nprefix\n[output cut at the bound]\n[Result truncated to fit the cap.]",
    );
  });

  it("ends a result the cap alone shortened with its notice and no marker", () => {
    // 20 KB of stdout is inside the executor's per-stream bound, so only the
    // 16,000-character result cap cut this result.
    expect(
      renderBashText({
        ...success,
        stdout: "kept",
        truncated: true,
        truncationNotice: "Result truncated to fit the cap.",
      }),
    ).toBe("exit 0\nkept\n[Result truncated to fit the cap.]");
  });

  it("reads the cut of a result stored before the cut flag from truncated", () => {
    expect(
      renderBashText({ ...success, stdout: "prefix", truncated: true }),
    ).toBe("exit 0\nprefix\n[output cut at the bound]");
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

  it("names a timeout instead of an exit code it never reported", () => {
    expect(
      renderBashText({
        status: "error",
        type: "timed_out",
        durationMs: 30_000,
        wallTimeMs: 30_000,
        stdout: "partial",
        stderr: "",
        truncated: false,
      }),
    ).toBe("timed out, 30.0 s\npartial");
  });

  it("omits the seconds of a timeout it never measured", () => {
    expect(
      renderBashText({
        status: "error",
        type: "timed_out",
        durationMs: 300_000,
        stdout: "",
        stderr: "",
        truncated: false,
      }),
    ).toBe("timed out\n(no output)");
  });

  it("keeps a single newline of output as one empty line", () => {
    expect(renderBashText({ ...success, stdout: "\n" })).toBe("exit 0\n");
    expect(renderBashText({ ...success, stderr: "\n" })).toBe(
      "exit 0\n[stderr]\n",
    );
  });
});
