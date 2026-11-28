/** The new-chat page's greeting for a local hour (0–23) and the name the
 *  owner asked to be called, if any. */
export function greeting(hour: number, name: string | null): string {
  const salutation =
    hour >= 5 && hour < 12
      ? "Good morning"
      : hour >= 12 && hour < 18
        ? "Good afternoon"
        : "Good evening";

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
