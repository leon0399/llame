import React from "react";
import { addons } from "storybook/manager-api";

import { COMMAND_EVENT } from "../constants.js";

export function TestProviderRow() {
  return (
    <button
      type="button"
      style={{ width: "100%" }}
      onClick={() =>
        addons.getChannel().emit(COMMAND_EVENT, { type: "run", scope: "all" })
      }
    >
      Run visual tests
    </button>
  );
}
