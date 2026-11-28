const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"];

/** A binary byte size with one decimal past KiB: `512 B`, `3.2 MiB`. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const shown =
    unit === 0 ? String(value) : value.toFixed(1).replace(/\.0$/, "");

  return `${shown} ${BYTE_UNITS[unit]}`;
}
