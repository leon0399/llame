import { absolutePathArgument, optionLikeArgument } from "./arguments";

describe("optionLikeArgument", () => {
  it.each([
    ["a worktree name", "-b"],
    ["a branch", "--force"],
    ["a base ref", "-"],
    ["a path", "-C"],
  ])("refuses %s that git would read as an option", (label, value) => {
    expect(optionLikeArgument(label, value)).toEqual({
      ok: false,
      message: `A git ${label} must not start with "-".`,
    });
  });

  it("accepts a value that only holds a dash", () => {
    expect(optionLikeArgument("branch", "llame/clear-field-0192")).toEqual({
      ok: true,
    });
  });
});

describe("absolutePathArgument", () => {
  it("accepts an absolute path unchanged", () => {
    expect(absolutePathArgument("/srv/app;rm -rf build")).toEqual({
      ok: true,
      path: "/srv/app;rm -rf build",
    });
  });

  it("refuses a relative path, an option-like path, and a NUL byte", () => {
    expect(absolutePathArgument("srv/app")).toMatchObject({ ok: false });
    expect(absolutePathArgument("--upload-pack=x")).toMatchObject({
      ok: false,
    });
    expect(absolutePathArgument("/srv/app\0")).toMatchObject({ ok: false });
  });
});
