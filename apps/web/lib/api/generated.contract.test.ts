import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  ChatPinnedItemResponse,
  ChatRefCard,
  OrgUnitConflictErrorResponse,
  OrgUnitResponse,
  ProjectPinnedItemResponse,
  ProjectRefCard,
} from "./generated/models";
import { createChildOrgUnit } from "./generated/org-units/org-units";
import type { createChildOrgUnitError } from "./generated/org-units/org-units";
import { getGetCurrentUserUrl } from "./generated/auth/auth";
import { getListPinsUrl, listPins, unpinItem } from "./generated/pins/pins";

const generatedRoot = join(import.meta.dirname, "generated");

function generatedTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? generatedTypeScriptFiles(path)
      : entry.name.endsWith(".ts")
        ? [path]
        : [];
  });
}

describe("generated API contract", () => {
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
    ).rejects.toMatchObject({ status: 409, info: errorBody });
  });

  it("keeps generated endpoint URLs relative and excludes streaming", () => {
    expect(getListPinsUrl()).toBe("/api/v1/pins");
    expect(getGetCurrentUserUrl()).toBe("/auth/v1/me");

    const files = generatedTypeScriptFiles(generatedRoot);
    const endpointFiles = files.filter((file) => !file.includes("/models/"));
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

    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(
      /\b(?:window|document|navigator|localStorage|sessionStorage)\b/,
    );
  });

  it("passes the injected fetch implementation to generated endpoints", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("[]", { status: 200 }));

    await expect(listPins(undefined, fetchMock)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/pins",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
