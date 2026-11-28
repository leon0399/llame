import {
  getTimeOfDay,
  type TimeOfDay,
} from "@workspace/ui/hooks/use-time-of-day";

const SALUTATIONS: Record<TimeOfDay, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
  // "Good night" is a farewell, so late hours keep the evening greeting.
  night: "Good evening",
};

/** The new-chat page's greeting for a local hour (0–23) and the name the
 *  owner asked to be called, if any. */
export function greeting(hour: number, name: string | null): string {
  const salutation = SALUTATIONS[getTimeOfDay(hour)];

  return name === null ? salutation : `${salutation}, ${name}`;
}

/** The name to greet: the preferred name from personalization, else the first
 *  word of the account name, else none. Blank values count as absent. */
export function greetingName(
  preferredName: string | null | undefined,
  accountName: string | null | undefined,
): string | null {
  const preferred = preferredName?.trim();

  if (preferred) return preferred;

  const first = accountName?.trim().split(/\s+/)[0];

  return first ? first : null;
}
