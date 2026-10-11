import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, readResolvedFile } from "./read";
import { IMAGE_SELECTOR_MESSAGE, type ImageReadHook } from "./image";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("png body"),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from("jpeg body"),
]);
const GIF = Buffer.from("GIF89a gif body");
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBPVP8 body"),
]);

const DECODED = {
  status: "success" as const,
  mediaType: "image/png",
  width: 1600,
  height: 900,
  thumbnail: "data:image/webp;base64,UklGRg==",
};

/** A hook that decodes whatever it is given and records what it was given. */
function decodingHook() {
  const handed: Array<{ byteSize: number; bytes: Buffer }> = [];
  const hook: ImageReadHook = async ({ byteSize, readBytes }) => {
    handed.push({ byteSize, bytes: await readBytes() });
    return DECODED;
  };
  return { hook, handed };
}

describe("native image reads", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "native-image-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("returns the decoded image for a host PNG, with no content or line metadata", async () => {
    const path = join(directory, "shot.png");
    await writeFile(path, PNG);
    const { hook, handed } = decodingHook();
    const result = await readFile({ path }, undefined, hook);
    expect(result).toEqual({ ...DECODED, kind: "image", path });
    expect(result).not.toHaveProperty("media");
    expect(handed).toEqual([{ byteSize: PNG.length, bytes: PNG }]);
  });

  it.each([
    ["JPEG", JPEG],
    ["GIF", GIF],
    ["WebP", WEBP],
  ])(
    "detects a %s by its leading bytes whatever the extension",
    async (_, bytes) => {
      const path = join(directory, "diagram.dat");
      await writeFile(path, bytes);
      const { hook, handed } = decodingHook();
      expect(await readFile({ path }, undefined, hook)).toMatchObject({
        status: "success",
        kind: "image",
      });
      expect(handed).toHaveLength(1);
    },
  );

  it.each([
    ["HTML named .png", "notes.png", "<!doctype html><p>hi</p>\n"],
    [
      "SVG",
      "logo.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>\n',
    ],
  ])("keeps %s on the text path", async (_, name, text) => {
    const path = join(directory, name);
    await writeFile(path, text);
    const { hook, handed } = decodingHook();
    expect(await readFile({ path }, undefined, hook)).toMatchObject({
      status: "success",
      kind: "file",
      content: `1: ${text}`,
    });
    expect(handed).toEqual([]);
  });

  it("reads a 25 MiB text file as text, never handing it to the hook", async () => {
    const path = join(directory, "app.log");
    await writeFile(path, "log line\n".repeat(Math.ceil((25 * 2 ** 20) / 9)));
    const { hook, handed } = decodingHook();
    expect(await readFile({ path }, undefined, hook)).toMatchObject({
      status: "success",
      kind: "file",
      truncated: true,
    });
    expect(handed).toEqual([]);
  });

  it.each([":1-10", ":raw", ":outline", ":-20", ":2-", ":raw:1-2"])(
    "refuses the %s selector on an image before any count or decode",
    async (selector) => {
      const path = join(directory, "shot.png");
      await writeFile(path, JPEG);
      const { hook, handed } = decodingHook();
      expect(
        await readFile({ path: `${path}${selector}` }, undefined, hook),
      ).toEqual({
        status: "error",
        type: "invalid_selector",
        message: IMAGE_SELECTOR_MESSAGE,
      });
      expect(handed).toEqual([]);
    },
  );

  it("returns a decode refusal as the read's failure, never as text", async () => {
    const path = join(directory, "huge.png");
    await writeFile(path, PNG);
    const hook: ImageReadHook = ({ byteSize }) => {
      expect(byteSize).toBe(PNG.length);
      return Promise.resolve({
        status: "error",
        type: "image_too_large",
        message: "Image exceeds 20 MiB or 40 megapixels",
      });
    };
    expect(await readFile({ path }, undefined, hook)).toEqual({
      status: "error",
      type: "image_too_large",
      message: "Image exceeds 20 MiB or 40 megapixels",
    });
  });

  it("reports the real path of a host image read through a link", async () => {
    const target = join(directory, "real.png");
    const link = join(directory, "link.png");
    await writeFile(target, PNG);
    await symlink(target, link);
    const { hook } = decodingHook();
    expect(await readFile({ path: link }, undefined, hook)).toEqual({
      ...DECODED,
      kind: "image",
      path: link,
      realPath: await realpath(target),
    });
  });

  it("reports a resolved image at the display path, never the host path", async () => {
    const path = join(directory, "flow.png");
    await writeFile(path, PNG);
    const { hook } = decodingHook();
    const result = await readResolvedFile(path, {
      displayPath: "kb://space/diagrams/flow.png",
      image: hook,
    });
    expect(result).toEqual({
      ...DECODED,
      kind: "image",
      path: "kb://space/diagrams/flow.png",
    });
    expect(JSON.stringify(result)).not.toContain(directory);
  });

  it("refuses a selector a resolver split off", async () => {
    const path = join(directory, "flow.png");
    await writeFile(path, PNG);
    const { hook, handed } = decodingHook();
    expect(
      await readResolvedFile(path, {
        displayPath: "kb://space/diagrams/flow.png",
        selector: "raw",
        image: hook,
      }),
    ).toMatchObject({ status: "error", type: "invalid_selector" });
    expect(handed).toEqual([]);
  });

  it("keeps an image on the text path when no hook is given", async () => {
    const path = join(directory, "shot.png");
    await writeFile(path, PNG);
    expect(await readFile({ path })).toMatchObject({
      status: "error",
      type: "invalid_utf8",
    });
  });
});
