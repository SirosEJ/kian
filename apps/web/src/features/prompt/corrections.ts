export type Correction = { from: string; to: string };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Puts the user's own spelling in place of a spoken form they have corrected before, whole words only (same rule as the server). */
export function applyCorrections(text: string, corrections: Correction[]): string {
  let out = text;
  for (const { from, to } of corrections) {
    if (from.replace(/\s/g, '').length < 3 || !to) continue;
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(from)}(?![\\p{L}\\p{N}])`, 'giu'), to);
  }
  return out;
}
