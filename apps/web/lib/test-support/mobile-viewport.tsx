import * as React from "react";

/** `useIsMobile` breaks at 768px (packages/ui/src/hooks/use-mobile.ts); 500 is a phone. */
const PHONE_WIDTH = 500;

/**
 * Gives a story a phone-sized viewport to render in. `useIsMobile` measures
 * `window.innerWidth`, and the story workspace runs one fixed browser
 * viewport (no viewport addon is installed), so a story that opts in shadows
 * that single measurement before the `SidebarProvider` inside reads it, and
 * puts the real one back when the story unmounts. Restoring means
 * reinstating the original property descriptor: deleting the override
 * instead would leave `innerWidth` undefined for every later story, which
 * reads as a desktop viewport and hides a real regression.
 */
export function MobileViewport({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const originalWidth = React.useRef<PropertyDescriptor | undefined>(undefined);

  if (active) {
    originalWidth.current ??= Object.getOwnPropertyDescriptor(
      window,
      "innerWidth",
    );
    Object.defineProperty(window, "innerWidth", {
      value: PHONE_WIDTH,
      configurable: true,
    });
  }

  React.useEffect(() => {
    if (!active) {
      return;
    }

    return () => {
      const original = originalWidth.current;

      if (original) {
        Object.defineProperty(window, "innerWidth", original);

        return;
      }

      Reflect.deleteProperty(window, "innerWidth");
    };
  }, [active]);

  return <>{children}</>;
}
