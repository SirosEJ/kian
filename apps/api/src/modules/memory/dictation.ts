import type { MemoryHint } from './store.js';

export type Correction = { from: string; to: string };
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’._-]*/gu;
const trimWord = (w: string) => w.replace(/^['’._-]+|['’._-]+$/g, '');
const tokens = (text: string) => (text.match(WORD) ?? []).map(trimWord).filter(Boolean);

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) { const tmp = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
  }
  return row[b.length];
}
/** How alike two spoken/written forms sound on the page, ignoring case and spaces: "Seros" and "Siros" are close, "meeting" and "call" are not. */
export function similarity(a: string, b: string): number {
  const x = a.toLowerCase().replace(/\s+/g, ''), y = b.toLowerCase().replace(/\s+/g, '');
  return x && y ? 1 - distance(x, y) / Math.max(x.length, y.length) : 0;
}

/**
 * The words the user changed after dictating: where one or two spoken words were replaced by one or two written words that look
 * alike ("Seros" to "Siros", "Sol man" to "Solmaz"). Pure insertions, deletions and rewordings are ignored.
 */
export function replacementPairs(dictated: string, final: string): Correction[] {
  const a = tokens(dictated), b = tokens(final);
  if (!a.length || !b.length || a.length > 300 || b.length > 300) return [];
  const la = a.map(w => w.toLowerCase()), lb = b.map(w => w.toLowerCase());
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = la[i] === lb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const pairs: Correction[] = [];
  let i = 0, j = 0, removed: string[] = [], added: string[] = [];
  const flush = () => {
    if (removed.length >= 1 && removed.length <= 2 && added.length >= 1 && added.length <= 2) {
      const from = removed.join(' '), to = added.join(' ');
      if (from.toLowerCase() !== to.toLowerCase() && from.replace(/\s/g, '').length >= 3 && similarity(from, to) >= 0.5) pairs.push({ from, to });
    }
    removed = []; added = [];
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && la[i] === lb[j]) { flush(); i++; j++; }
    else if (j >= b.length || (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1])) removed.push(a[i++]);
    else added.push(b[j++]);
  }
  flush();
  return pairs;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Puts the user's own spelling in place of the spoken form they have corrected before, whole words only. */
export function applyCorrections(text: string, corrections: Correction[]): string {
  let out = text;
  for (const { from, to } of corrections) {
    if (from.replace(/\s/g, '').length < 3 || !to) continue;
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(from)}(?![\\p{L}\\p{N}])`, 'giu'), to);
  }
  return out;
}

const BASE = ['Kian', 'Jira', 'Sepenta', 'Google Calendar'];
const VOCAB_KINDS = new Set(['person', 'project', 'epic', 'calendar', 'meeting', 'correction']);
/** A short list of the names this user says, for the transcription model to recognise. Never addresses, never long titles. */
export function vocabularyPrompt(terms: MemoryHint[], max = 600): string {
  const words: string[] = [...BASE];
  for (const t of terms) {
    if (!VOCAB_KINDS.has(t.kind) || t.value.includes('@')) continue;
    const word = (t.kind === 'epic' ? t.value.split(':')[0] : t.value).trim().slice(0, 50);
    if (word && !words.some(w => w.toLowerCase() === word.toLowerCase())) words.push(word);
  }
  let prompt = 'Names and terms the speaker may say: ';
  for (const w of words) { if (prompt.length + w.length + 2 > max) break; prompt += `${w}, `; }
  return `${prompt.replace(/, $/, '')}.`;
}
