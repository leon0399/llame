import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve as resolvePath,
  sep,
} from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  ChatPinnedItemResponse,
  ChatRefCard,
  OrgUnitConflictErrorResponse,
  OrgUnitResponse,
  ProjectPinnedItemResponse,
  ProjectRefCard,
  UpdatePersonalizationDto,
} from "./generated/models";
import { loginUser } from "./generated/auth/auth";
import { listChats } from "./generated/chats/chats";
import { createChildOrgUnit } from "./generated/org-units/org-units";
import type { createChildOrgUnitError } from "./generated/org-units/org-units";
import { getCurrentUser, getGetCurrentUserUrl } from "./generated/auth/auth";
import { listModels } from "./generated/models/models";
import { getListPinsUrl, listPins, unpinItem } from "./generated/pins/pins";

const generatedRoot = join(import.meta.dirname, "generated");

function generatedTypeScriptFiles(directory: string): Array<string> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? generatedTypeScriptFiles(path)
      : entry.name.endsWith(".ts")
        ? [path]
        : [];
  });
}

function generatedEndpointTypeScriptFiles(directory: string): Array<string> {
  return generatedTypeScriptFiles(directory).filter((file) => {
    const source = readFileSync(file, "utf8");
    return /export const \w+ = async \(/.test(source);
  });
}

function generatedImportSpecifiers(source: string): Array<string> {
  const code = source.replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const fromImports = code.matchAll(
    /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?[\s\S]*?\sfrom\s*["']([^"']+)["']/g,
  );
  const sideEffectImports = code.matchAll(
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
  );

  return [
    ...Array.from(fromImports, (match) => match[1]!),
    ...Array.from(sideEffectImports, (match) => match[1]!),
  ];
}

function resolveGeneratedModule(sourceFile: string, specifier: string) {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const modulePath = resolvePath(dirname(sourceFile), specifier);
  const extension = extname(modulePath);
  const sourceExtensions = [".ts", ".mts", ".cts"];
  const candidates = sourceExtensions.includes(extension)
    ? [modulePath]
    : [
        ...sourceExtensions.map((sourceExtension) =>
          extension === ".js" || extension === ".mjs" || extension === ".cjs"
            ? `${modulePath.slice(0, -extension.length)}${sourceExtension}`
            : `${modulePath}${sourceExtension}`,
        ),
        ...sourceExtensions.map((sourceExtension) =>
          join(modulePath, `index${sourceExtension}`),
        ),
      ];

  return candidates.find((candidate) => {
    return existsSync(candidate) && statSync(candidate).isFile();
  });
}

function isGeneratedInternalImport(sourceFile: string, specifier: string) {
  const resolvedModule = resolveGeneratedModule(sourceFile, specifier);
  if (!resolvedModule) {
    return false;
  }

  const pathFromGeneratedRoot = relative(generatedRoot, resolvedModule);
  return (
    pathFromGeneratedRoot !== "" &&
    !isAbsolute(pathFromGeneratedRoot) &&
    pathFromGeneratedRoot !== ".." &&
    !pathFromGeneratedRoot.startsWith(`..${sep}`)
  );
}

describe("generated API contract", () => {
  it("keeps personalization input fields nullable strings", () => {
    const source = readFileSync(
      join(generatedRoot, "models", "updatePersonalizationDto.ts"),
      "utf8",
    );

    expect(source).toMatch(/preferredName\?: string \| null;/);
    expect(source).toMatch(/about\?: string \| null;/);
    expect(source).toMatch(/responsePreferences\?: string \| null;/);

    const update: UpdatePersonalizationDto = {
      preferredName: "Ada",
      about: "Engineer",
      responsePreferences: "Concise",
    };
    expect(update).toEqual({
      preferredName: "Ada",
      about: "Engineer",
      responsePreferences: "Concise",
    });
  });

  it("keeps nullable direct roles nullable", () => {
    const directRole: OrgUnitResponse["directRole"] = null;

    expect(directRole).toBeNull();
  });

  it("keeps discriminated pin responses correlated with their cards", () => {
    const chatPin: ChatPinnedItemResponse = {
      itemType: "chat",
      itemId: "chat-1",
      pinnedAt: "2026-08-21T00:00:00.000Z",
      item: { id: "chat-1", title: "Chat", archivedAt: null },
    };
    const projectPin: ProjectPinnedItemResponse = {
      itemType: "project",
      itemId: "project-1",
      pinnedAt: "2026-08-21T00:00:00.000Z",
      item: { id: "project-1", name: "Project", archivedAt: null },
    };

    function cardId(pin: ChatPinnedItemResponse | ProjectPinnedItemResponse) {
      if (pin.itemType === "chat") {
        const card: ChatRefCard = pin.item;
        return card.id;
      }

      const card: ProjectRefCard = pin.item;
      return card.id;
    }

    expect(cardId(chatPin)).toBe("chat-1");
    expect(cardId(projectPin)).toBe("project-1");
  });

  it("returns void for a representative 204 endpoint", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));

    const result: void = await unpinItem(
      "chat",
      "chat-1",
      undefined,
      fetchMock,
    );

    expect(result).toBeUndefined();
  });

  it("preserves typed error status and body data", async () => {
    const errorBody: OrgUnitConflictErrorResponse = {
      statusCode: 409,
      error: "Conflict",
      message: "Membership already exists",
      code: "DUPLICATE_MEMBERSHIP",
    };
    const typedErrorBody: Extract<
      createChildOrgUnitError,
      OrgUnitConflictErrorResponse
    > = errorBody;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(typedErrorBody), { status: 409 }),
      );

    await expect(
      createChildOrgUnit("org-1", { name: "Child" }, undefined, fetchMock),
    ).rejects.toMatchObject({
      message: "POST /api/v1/org-units/org-1/children failed (409)",
      status: 409,
      info: errorBody,
    });
  });

  it("preserves status and raw text for non-JSON errors", async () => {
    const rawBody = "<html><body>unauthorized</body></html>";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(rawBody, { status: 401 }));

    await expect(getCurrentUser(undefined, fetchMock)).rejects.toMatchObject({
      status: 401,
      info: rawBody,
    });
  });

  it("preserves status and raw text for malformed JSON errors", async () => {
    const rawBody = "{bad json";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(rawBody, {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(getCurrentUser(undefined, fetchMock)).rejects.toMatchObject({
      status: 401,
      info: rawBody,
    });
  });

  it("keeps empty error bodies safe", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));

    await expect(getCurrentUser(undefined, fetchMock)).rejects.toMatchObject({
      status: 401,
      info: {},
    });
  });

  it("keeps generated endpoint URLs relative and excludes streaming", () => {
    expect(getListPinsUrl()).toBe("/api/v1/pins");
    expect(getGetCurrentUserUrl()).toBe("/auth/v1/me");

    const files = generatedTypeScriptFiles(generatedRoot);
    const endpointFiles = generatedEndpointTypeScriptFiles(generatedRoot);
    expect(endpointFiles).toContain(join(generatedRoot, "models", "models.ts"));
    const endpointSource = endpointFiles
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(files.some((file) => file.includes("/streaming/"))).toBe(false);
    expect(endpointSource).not.toMatch(
      /export const \w*(?:stream|streaming)\w*\s*=/i,
    );
    expect(endpointSource).not.toMatch(/https?:\/\//);
  });

  it("contains no framework, environment, or browser imports", () => {
    const source = generatedTypeScriptFiles(generatedRoot)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(source).not.toMatch(
      /(?:from|import)\s+["'](?:next|react|@tanstack\/react-query)(?:\/|["'])/,
    );
    expect(source).not.toMatch(/(?:NEXT_PUBLIC|process\.env)/);

    const code = source.replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(
      /\b(?:window|document|navigator|localStorage|sessionStorage)\b/,
    );
  });

  it("keeps generated imports relative to the generated client", () => {
    const imports = generatedTypeScriptFiles(generatedRoot).flatMap((file) =>
      generatedImportSpecifiers(readFileSync(file, "utf8")).map(
        (specifier) => ({
          file,
          specifier,
        }),
      ),
    );
    const externalImports = imports.filter(
      ({ file, specifier }) => !isGeneratedInternalImport(file, specifier),
    );

    expect(imports.length).toBeGreaterThan(0);
    expect(externalImports).toEqual([]);
  });

  it.each([
    "@/lib/api/fetch",
    "@/lib/services/auth",
    "next/navigation",
    "react",
    "@tanstack/react-query",
    "process",
    "window",
    "./../../fetch",
    "./../../services/auth",
  ])("rejects external generated import %s", (specifier) => {
    const endpointFile = join(generatedRoot, "auth", "auth.ts");

    expect(isGeneratedInternalImport(endpointFile, "../models")).toBe(true);
    expect(isGeneratedInternalImport(endpointFile, specifier)).toBe(false);
  });

  it("passes the injected fetch implementation to representative endpoints", async () => {
    const listModelsFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const loginFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const listChatsFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("[]", { status: 200 }));
    const listPinsFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("[]", { status: 200 }));

    await listModels(undefined, listModelsFetch);
    await loginUser(
      { email: "user@example.com", password: "secret" },
      undefined,
      loginFetch,
    );
    await listChats({ projectId: "project-1" }, undefined, listChatsFetch);
    await listPins(undefined, listPinsFetch);

    expect(listModelsFetch).toHaveBeenCalledWith(
      "/api/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
    expect(loginFetch).toHaveBeenCalledWith(
      "/auth/v1/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "user@example.com", password: "secret" }),
      }),
    );
    expect(listChatsFetch).toHaveBeenCalledWith(
      "/api/v1/chats?projectId=project-1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(listPinsFetch).toHaveBeenCalledWith(
      "/api/v1/pins",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("requires an injected fetch policy in generated endpoint signatures", () => {
    const endpointFiles = generatedEndpointTypeScriptFiles(generatedRoot);
    expect(endpointFiles).toContain(join(generatedRoot, "models", "models.ts"));
    expect(endpointFiles).not.toContain(
      join(generatedRoot, "models", "availableModelResponse.ts"),
    );

    const endpointSources = endpointFiles.map((file) =>
      readFileSync(file, "utf8"),
    );
    for (const source of endpointSources) {
      expect(source).toMatch(
        /options: RequestInit \| undefined,\n {2}fetchFn: typeof globalThis\.fetch/,
      );
      expect(source).not.toMatch(/fetchFn\?: typeof globalThis\.fetch/);
    }

    const endpointSource = endpointSources.join("\n");

    expect(endpointSource).not.toContain("fetchFn ?? fetch");

    const callsWithoutFetch = [
      () => {
        // @ts-expect-error Generated endpoints require the runtime Fetch policy.
        return listModels(undefined);
      },
      () => {
        // @ts-expect-error Generated endpoints require the runtime Fetch policy.
        return loginUser(
          { email: "user@example.com", password: "secret" },
          undefined,
        );
      },
      () => {
        // @ts-expect-error Generated endpoints require the runtime Fetch policy.
        return listChats(undefined, undefined);
      },
      () => {
        // @ts-expect-error Generated endpoints require the runtime Fetch policy.
        return listPins(undefined);
      },
    ];
    expect(callsWithoutFetch).toHaveLength(4);
  });

  it("fails closed when the generated endpoint fetch policy is omitted", async () => {
    const globalFetch = vi.spyOn(globalThis, "fetch");

    try {
      await expect(
        (async () => {
          // @ts-expect-error Generated endpoints require the runtime Fetch policy.
          return listPins(undefined, undefined);
        })(),
      ).rejects.toThrow(TypeError);
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      globalFetch.mockRestore();
    }
  });
});
