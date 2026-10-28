/**
 * Formats a byte count.
 *
 * @param size - The size in bytes.
 * @returns The formatted text.
 */
export function formatBytes(size: number): string {
  if (size === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let remaining = size;
  let index = 0;

  while (remaining >= 1024 && index < units.length - 1) {
    remaining /= 1024;
    index += 1;
  }

  return `${remaining.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
