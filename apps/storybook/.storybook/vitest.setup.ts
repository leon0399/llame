import { setProjectAnnotations } from "@storybook/nextjs-vite";
import * as a11y from "@storybook/addon-a11y/preview";
import { configure } from "storybook/test";

import * as preview from "./preview";

setProjectAnnotations([a11y, preview]);

// `findBy*` and `waitFor` default to 1 s. A dialog's open and close
// transitions alone take most of that on a loaded machine running the stories
// in parallel, so the jsdom suites' 5 s budget applies here too.
configure({ asyncUtilTimeout: 5000 });
