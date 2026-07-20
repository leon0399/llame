import React from "react";
import {
  addons,
  experimental_getStatusStore,
  experimental_getTestProviderStore,
  types,
  useStorybookState,
} from "storybook/manager-api";

import {
  ADDON_ID,
  COMMAND_EVENT,
  PANEL_ID,
  STATE_EVENT,
  STATUS_TYPE_ID,
  TEST_PROVIDER_ID,
  TOOL_ID,
} from "./constants.js";
import { Panel } from "./manager/Panel.js";
import { statusValueFor } from "./manager/state.js";
import { TestProviderRow } from "./manager/TestProviderRow.js";
import type { VisualRunState } from "./shared/results.js";

const statusStore = experimental_getStatusStore(STATUS_TYPE_ID);
const testProviderStore = experimental_getTestProviderStore(TEST_PROVIDER_ID);
const isDevelopment =
  (globalThis as typeof globalThis & { CONFIG_TYPE?: string }).CONFIG_TYPE ===
  "DEVELOPMENT";

addons.register(ADDON_ID, (api) => {
  addons.add(PANEL_ID, {
    type: types.PANEL,
    title: "Visual tests",
    match: ({ viewMode }) => viewMode === "story",
    render: () => <Panel />,
  });

  if (!isDevelopment) return;

  const channel = addons.getChannel();
  channel.on(STATE_EVENT, (state: VisualRunState) => {
    statusStore.unset();
    const statuses = state.results.map((result) => ({
      typeId: STATUS_TYPE_ID,
      storyId: result.storyId,
      value: statusValueFor(result),
      title: "Visual test",
      description: result.message ?? result.status,
      data: { runId: result.runId, environmentKey: result.environmentKey },
    }));
    if (statuses.length > 0) statusStore.set(statuses);
  });
  statusStore.onSelect(() => {
    api.setSelectedPanel(PANEL_ID);
    api.togglePanel(true);
  });
  testProviderStore.onRunAll(() => {
    channel.emit(COMMAND_EVENT, { type: "run", scope: "all" });
  });
  testProviderStore.onClearAll(() => statusStore.unset());

  addons.add(TEST_PROVIDER_ID, {
    type: types.experimental_TEST_PROVIDER,
    clear: () => statusStore.unset(),
    render: () => <TestProviderRow />,
  });
  addons.add(TOOL_ID, {
    type: types.TOOL,
    title: "Run visual test",
    match: ({ viewMode }) => viewMode === "story",
    render: () => <RunCurrentTool />,
  });
});

function RunCurrentTool() {
  const { storyId } = useStorybookState();
  return (
    <button
      type="button"
      title="Run visual test for current story"
      disabled={!storyId}
      onClick={() =>
        storyId &&
        addons
          .getChannel()
          .emit(COMMAND_EVENT, { type: "run", scope: "current", storyId })
      }
    >
      ◉
    </button>
  );
}
