import React from "react";
import {
  addons,
  experimental_getStatusStore,
  experimental_getTestProviderStore,
  types,
} from "storybook/manager-api";

import {
  ADDON_ID,
  COMMAND_EVENT,
  PANEL_ID,
  STATUS_TYPE_ID,
  TEST_PROVIDER_ID,
} from "./constants.js";
import { Panel } from "./manager/Panel.js";
import {
  createRetryingProjection,
  subscribeToVisualState,
} from "./manager/channel.js";
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
  let ready = false;
  let pendingRunAll = false;
  const statusProjection = createRetryingProjection<VisualRunState>(
    (state) => {
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
    },
    (error) =>
      error instanceof Error &&
      error.message.includes("Cannot set state before store is ready"),
  );
  subscribeToVisualState(channel, (state: VisualRunState) => {
    ready = true;
    testProviderStore.setState(
      state.running
        ? "test-provider-state:running"
        : state.results.length > 0 &&
            !state.results.every(({ status }) => status === "cancelled")
          ? "test-provider-state:succeeded"
          : "test-provider-state:pending",
    );
    if (pendingRunAll) {
      pendingRunAll = false;
      channel.emit(COMMAND_EVENT, { type: "run", scope: "all" });
    }
    statusProjection.project(state);
  });
  statusStore.onSelect(() => {
    api.setSelectedPanel(PANEL_ID);
    api.togglePanel(true);
  });
  testProviderStore.onRunAll(() => {
    if (ready) {
      channel.emit(COMMAND_EVENT, { type: "run", scope: "all" });
    } else {
      pendingRunAll = true;
    }
  });
  testProviderStore.onClearAll(() => statusStore.unset());

  addons.add(TEST_PROVIDER_ID, {
    type: types.experimental_TEST_PROVIDER,
    clear: () => statusStore.unset(),
    render: () => <TestProviderRow />,
  });
});
