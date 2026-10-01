/** The letter shown on the profile button: the first letter or digit of the email, upper-cased. */
export function initialOf(email: string | null | undefined): string {
  const match = (email || '').match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : '?';
}

/** Which menu item gets focus after an arrow, Home or End key (wraps around). */
export function nextIndex(current: number, count: number, key: string): number {
  if (count <= 0) return -1;
  if (key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowUp') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return current;
}
