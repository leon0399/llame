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

const STORED = {
  status: "success" as const,
  media: "media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f",
  mediaType: "image/png",
  width: 1600,
  height: 900,
};

/** A hook that stores whatever it is given and records what it was given. */
function storingHook() {
  const ingested: Array<{ byteSize: number; bytes: Buffer }> = [];
  const hook: ImageReadHook = async ({ byteSize, readBytes }) => {
    ingested.push({ byteSize, bytes: await readBytes() });
    return STORED;
  };
  return { hook, ingested };
}

describe("native image reads", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "native-image-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("returns the stored image for a host PNG, with no content or line metadata", async () => {
    const path = join(directory, "shot.png");
    await writeFile(path, PNG);
    const { hook, ingested } = storingHook();
    const result = await readFile({ path }, undefined, hook);
    expect(result).toEqual({ ...STORED, kind: "image", path });
    expect(ingested).toEqual([{ byteSize: PNG.length, bytes: PNG }]);
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
      const { hook, ingested } = storingHook();
      expect(await readFile({ path }, undefined, hook)).toMatchObject({
        status: "success",
        kind: "image",
      });
      expect(ingested).toHaveLength(1);
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
    const { hook, ingested } = storingHook();
    expect(await readFile({ path }, undefined, hook)).toMatchObject({
      status: "success",
      kind: "file",
      content: `1: ${text}`,
    });
    expect(ingested).toEqual([]);
  });

  it("reads a 25 MiB text file as text, never handing it to the hook", async () => {
    const path = join(directory, "app.log");
    await writeFile(path, "log line\n".repeat(Math.ceil((25 * 2 ** 20) / 9)));
    const { hook, ingested } = storingHook();
    expect(await readFile({ path }, undefined, hook)).toMatchObject({
      status: "success",
      kind: "file",
      truncated: true,
    });
    expect(ingested).toEqual([]);
  });

  it.each([":1-10", ":raw", ":outline", ":-20", ":2-", ":raw:1-2"])(
    "refuses the %s selector on an image before any count or ingest",
    async (selector) => {
      const path = join(directory, "shot.png");
      await writeFile(path, JPEG);
      const { hook, ingested } = storingHook();
      expect(
        await readFile({ path: `${path}${selector}` }, undefined, hook),
      ).toEqual({
        status: "error",
        type: "invalid_selector",
        message: IMAGE_SELECTOR_MESSAGE,
      });
      expect(ingested).toEqual([]);
    },
  );

  it("returns an ingest refusal as the read's failure, never as text", async () => {
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
    const { hook } = storingHook();
    expect(await readFile({ path: link }, undefined, hook)).toEqual({
      ...STORED,
      kind: "image",
      path: link,
      realPath: await realpath(target),
    });
  });

  it("reports a resolved image at the display path, never the host path", async () => {
    const path = join(directory, "flow.png");
    await writeFile(path, PNG);
    const { hook } = storingHook();
    const result = await readResolvedFile(path, {
      displayPath: "kb://space/diagrams/flow.png",
      image: hook,
    });
    expect(result).toEqual({
      ...STORED,
      kind: "image",
      path: "kb://space/diagrams/flow.png",
    });
    expect(JSON.stringify(result)).not.toContain(directory);
  });

  it("refuses a selector a resolver split off", async () => {
    const path = join(directory, "flow.png");
    await writeFile(path, PNG);
    const { hook, ingested } = storingHook();
    expect(
      await readResolvedFile(path, {
        displayPath: "kb://space/diagrams/flow.png",
        selector: "raw",
        image: hook,
      }),
    ).toMatchObject({ status: "error", type: "invalid_selector" });
    expect(ingested).toEqual([]);
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
