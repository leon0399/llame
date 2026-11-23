import { describe, expect, it } from "vitest";

import type {
  AvailableModelResponse,
  ChatModelSelectionResponse,
  ModelsResponse,
} from "../../api/generated/models";
import {
  acceptedSelectionFor,
  applicableHold,
  composerSelection,
  displayedEffort,
  localTimeOf,
  resolveDisplayedEffort,
  resolveDisplayedModel,
  resolveSendSelection,
} from "./selection";

const NOW = new Date("2026-11-23T12:00:00.000Z");

function model(
  id: string,
  name: string,
  effortLevels?: Array<{ value: string; label?: string }>,
  defaultEffort?: string,
): AvailableModelResponse {
  return {
    id,
    source: "system",
    name,
    contextWindowTokens: 400_000,
    input: ["text"],
    ...(effortLevels !== undefined && {
      reasoning: {
        effortLevels,
        defaultEffort: defaultEffort ?? effortLevels[0]?.value ?? "none",
        cacheInvalidatedByEffortChange: false,
      },
    }),
  };
}

const CODEX = model(
  "system:openai:codex",
  "Codex",
  [{ value: "low" }, { value: "high" }],
  "high",
);

const SONNET = model(
  "system:anthropic:sonnet",
  "Claude Sonnet",
  [{ value: "low" }, { value: "medium" }, { value: "high" }],
  "medium",
);

const PLAIN = model("system:openai:plain", "Plain");

const CATALOG: ModelsResponse = {
  defaultSelector: "@coding",
  models: [CODEX, SONNET, PLAIN],
  roles: [
    {
      selector: "@coding",
      candidates: [
        { modelId: CODEX.id, effort: "high", paid: false },
        { modelId: SONNET.id, paid: true },
      ],
    },
    {
      selector: "@plain",
      candidates: [{ modelId: PLAIN.id, paid: false }],
    },
  ],
};

function hold(overrides: {
  revertAt: string;
  modelId?: string;
  effort?: string;
}) {
  return {
    selector: "@coding",
    modelId: overrides.modelId ?? SONNET.id,
    effort: overrides.effort ?? null,
    revertAt: overrides.revertAt,
  };
}

describe("composerSelection", () => {
  const stored: ChatModelSelectionResponse = {
    selector: "@coding",
    effort: "low",
    hold: hold({ revertAt: "2026-11-23T13:00:00.000Z" }),
  };

  it("shows the catalog default for a Chat that stores none", () => {
    expect(composerSelection(null, CATALOG)).toEqual({
      selector: "@coding",
      effort: null,
    });
  });

  it("shows the stored selection as the Chat read reports it", () => {
    expect(composerSelection(stored, CATALOG)).toEqual(stored);
  });

  it("falls back to the default when the stored selector left the catalog", () => {
    expect(
      composerSelection(
        { selector: "system:openai:retired", effort: "high" },
        CATALOG,
      ),
    ).toEqual({ selector: "@coding", effort: null });
  });

  it("shows the stored selection unchanged while the catalog loads", () => {
    expect(composerSelection(stored, undefined)).toEqual(stored);
  });

  it("shows nothing yet for a Chat with no selection while the catalog loads", () => {
    expect(composerSelection(null, undefined)).toBeNull();
  });

  it("replaces the whole selection on a selector pick", () => {
    expect(composerSelection(stored, CATALOG, { selector: "@plain" })).toEqual({
      selector: "@plain",
      effort: null,
    });
  });

  it("keeps the hold and selector on an effort pick", () => {
    expect(composerSelection(stored, CATALOG, { effort: "high" })).toEqual({
      ...stored,
      effort: "high",
    });
  });
});

describe("resolveDisplayedModel", () => {
  const role: ChatModelSelectionResponse = {
    selector: "@coding",
    effort: null,
  };

  it("resolves a role to its first candidate", () => {
    expect(resolveDisplayedModel(role, CATALOG, NOW)).toEqual(CODEX);
  });

  it("resolves an exact selector to its model", () => {
    expect(
      resolveDisplayedModel(
        { selector: SONNET.id, effort: null },
        CATALOG,
        NOW,
      ),
    ).toEqual(SONNET);
  });

  it("resolves a held role to the held model before revertAt", () => {
    const held = {
      ...role,
      hold: hold({ revertAt: "2026-11-23T13:00:00.000Z" }),
    };

    expect(resolveDisplayedModel(held, CATALOG, NOW)).toEqual(SONNET);
  });

  it("returns to the primary once revertAt passed", () => {
    const expired = {
      ...role,
      hold: hold({ revertAt: "2026-11-23T11:00:00.000Z" }),
    };

    expect(applicableHold(expired, CATALOG, NOW)).toBeUndefined();
    expect(resolveDisplayedModel(expired, CATALOG, NOW)).toEqual(CODEX);
  });

  it("drops a hold whose model left the role", () => {
    const orphaned = {
      ...role,
      hold: hold({
        revertAt: "2026-11-23T13:00:00.000Z",
        modelId: "system:openai:retired",
      }),
    };

    expect(resolveDisplayedModel(orphaned, CATALOG, NOW)).toEqual(CODEX);
  });

  it("resolves nothing for a selector the catalog does not offer", () => {
    expect(
      resolveDisplayedModel(
        { selector: "@missing", effort: null },
        CATALOG,
        NOW,
      ),
    ).toBeUndefined();
  });
});

describe("resolveDisplayedEffort", () => {
  it("uses the held model's own default when the hold pins no effort", () => {
    const held = {
      selector: "@coding",
      effort: "high",
      hold: hold({ revertAt: "2026-11-23T13:00:00.000Z" }),
    };

    expect(resolveDisplayedEffort(held, CATALOG, NOW)).toBe("medium");
  });

  it("uses the effort the hold pins", () => {
    const held = {
      selector: "@coding",
      effort: null,
      hold: hold({ revertAt: "2026-11-23T13:00:00.000Z", effort: "low" }),
    };

    expect(resolveDisplayedEffort(held, CATALOG, NOW)).toBe("low");
  });

  it("uses the stored effort when it names no selector", () => {
    expect(
      resolveDisplayedEffort(
        { selector: "@coding", effort: "low" },
        CATALOG,
        NOW,
      ),
    ).toBe("low");
  });

  it("ignores a stored level the model no longer declares", () => {
    expect(
      resolveDisplayedEffort(
        { selector: SONNET.id, effort: "xhigh" },
        CATALOG,
        NOW,
      ),
    ).toBe("medium");
  });

  it("falls through the candidate effort to the model default", () => {
    expect(
      resolveDisplayedEffort(
        { selector: "@coding", effort: null },
        CATALOG,
        NOW,
      ),
    ).toBe("high");
    expect(
      resolveDisplayedEffort(
        { selector: "@plain", effort: null },
        CATALOG,
        NOW,
      ),
    ).toBeUndefined();
  });
});

describe("displayedEffort", () => {
  const held = {
    selector: "@coding",
    effort: null,
    hold: hold({ revertAt: "2026-11-23T13:00:00.000Z", effort: "low" }),
  };

  it("shows the owner's unsent pick over the hold's effort", () => {
    expect(
      displayedEffort({
        selection: held,
        model: SONNET,
        pickedEffort: "high",
        data: CATALOG,
        now: NOW,
      }),
    ).toBe("high");
  });

  it("ignores a pick the resolved model does not declare", () => {
    expect(
      displayedEffort({
        selection: held,
        model: SONNET,
        pickedEffort: "xhigh",
        data: CATALOG,
        now: NOW,
      }),
    ).toBe("low");
  });

  it("falls back to the selection's own effort without a pick", () => {
    expect(
      displayedEffort({
        selection: held,
        model: SONNET,
        pickedEffort: undefined,
        data: CATALOG,
        now: NOW,
      }),
    ).toBe("low");
  });
});

describe("resolveSendSelection", () => {
  const shown = composerSelection(null, CATALOG);

  it("names the shown selection on a new Chat's first send", () => {
    expect(
      resolveSendSelection({
        selection: shown,
        model: CODEX,
        firstSend: true,
        picks: {},
        shownEffort: "high",
      }),
    ).toEqual({ selector: "@coding", effort: "high", ready: true });
  });

  it("names nothing on an existing Chat without picks", () => {
    expect(
      resolveSendSelection({
        selection: shown,
        model: CODEX,
        firstSend: false,
        picks: {},
        shownEffort: "high",
      }),
    ).toEqual({ ready: true });
  });

  it("names a picked selector, never the shown one", () => {
    expect(
      resolveSendSelection({
        selection: shown,
        model: CODEX,
        firstSend: false,
        picks: { selector: SONNET.id },
        shownEffort: "high",
      }),
    ).toEqual({ selector: SONNET.id, ready: true });
  });

  it("names a picked effort only when the resolved model declares it", () => {
    expect(
      resolveSendSelection({
        selection: shown,
        model: CODEX,
        firstSend: false,
        picks: { effort: "low" },
        shownEffort: "high",
      }),
    ).toEqual({ effort: "low", ready: true });

    expect(
      resolveSendSelection({
        selection: shown,
        model: PLAIN,
        firstSend: false,
        picks: { effort: "low" },
        shownEffort: undefined,
      }),
    ).toEqual({ ready: true });
  });

  it("is not ready without a resolvable selection", () => {
    expect(
      resolveSendSelection({
        selection: null,
        model: undefined,
        firstSend: true,
        picks: {},
        shownEffort: undefined,
      }),
    ).toEqual({ ready: false });
  });
});

describe("acceptedSelectionFor", () => {
  const stored: ChatModelSelectionResponse = {
    selector: "@coding",
    effort: null,
    hold: hold({ revertAt: "2026-11-23T13:00:00.000Z", effort: "low" }),
  };

  it("shows nothing new when the send named nothing", () => {
    expect(acceptedSelectionFor({ ready: true }, stored, "low")).toBeNull();
  });

  it("keeps the hold on an effort-only send", () => {
    expect(
      acceptedSelectionFor({ effort: "high", ready: true }, stored, "high"),
    ).toEqual({ selector: "@coding", effort: "high", hold: stored.hold });
  });

  it("drops the hold on a selector send", () => {
    expect(
      acceptedSelectionFor({ selector: "@plain", ready: true }, stored, "high"),
    ).toEqual({ selector: "@plain", effort: "high" });
  });
});

describe("localTimeOf", () => {
  it("formats the local clock as HH:MM", () => {
    const instant = new Date(2026, 10, 23, 14, 5);

    expect(localTimeOf(instant.toISOString())).toBe("14:05");
  });
});
