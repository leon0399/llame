import type { StorybookTheme } from "storybook/theming";

declare module "storybook/theming" {
  interface Theme extends StorybookTheme {}
}
