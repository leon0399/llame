"use client";

import { AlertTriangleIcon, MapPinIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";

import { LocationCascade } from "./location-cascade";
import type { ComposerLocation } from "./use-composer-location";

/** The chip's one accessible name: the resolved root and any warning. */
function chipAriaLabel(location: ComposerLocation): string {
  const parts = [...location.chip.segments];
  if (location.chip.unresolved !== null) parts.push(location.chip.unresolved);
  if (location.chip.detail !== null) parts.push(location.chip.detail);
  const summary = parts.join(". ");
  return location.location.warning === null
    ? `Chat location: ${summary}`
    : `Chat location: ${summary}. Warning: ${location.location.warning.message}`;
}

function ChipSummary({ location }: { location: ComposerLocation }) {
  const warning = location.location.warning;
  return (
    // The icon carries the warning colour: destructive body text at this
    // small size fails the contrast ratio on the quiet surfaces it sits on.
    <span className="flex min-w-0 items-start gap-1.5">
      {warning === null ? (
        <MapPinIcon
          size={14}
          aria-hidden
          className="mt-0.5 shrink-0 text-muted-foreground"
        />
      ) : (
        <AlertTriangleIcon
          size={14}
          aria-hidden
          className="mt-0.5 shrink-0 text-destructive"
        />
      )}
      <span className="flex min-w-0 flex-col items-start">
        <span className="max-w-full truncate text-xs">
          {location.chip.segments.join(" · ")}
          {location.chip.unresolved === null
            ? null
            : ` · ${location.chip.unresolved}`}
        </span>
        {location.chip.detail === null ? null : (
          <span className="max-w-full truncate text-xs">
            {location.chip.detail}
          </span>
        )}
      </span>
    </span>
  );
}

type LocationChipProps = {
  /** The one resolved-location module's state; the chip never resolves alone. */
  location: ComposerLocation;
  className?: string;
};

/**
 * The location chip of design D10: the resolved bound root in one quiet
 * trigger; a click opens the cascade popover that can change every level. A
 * warning state still sends: the create answers `unbound`, or names the failed
 * step it kept the draft for.
 */
export function LocationChip({ location, className }: LocationChipProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={chipAriaLabel(location)}
            className={cn(
              "h-auto min-w-0 max-w-full justify-start text-left",
              className,
            )}
          />
        }
      >
        <ChipSummary location={location} />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-96">
        <PopoverTitle className="sr-only">Chat location</PopoverTitle>
        <LocationCascade location={location} />
      </PopoverContent>
    </Popover>
  );
}
