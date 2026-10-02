import { randomUUID } from 'node:crypto';
import type { Queryable } from '@kian/db';
import { replacementPairs, vocabularyPrompt, type Correction } from './dictation.js';

export const MEMORY_LIMITS = { entries: 500, value: 80, alias: 60, detail: 80, relevant: 12, learnPerTurn: 3 } as const;
export const MEMORY_KINDS = ['person', 'project', 'epic', 'calendar', 'meeting', 'correction'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemorySource = 'jira' | 'calendar' | 'email' | 'chat' | 'manual';
/** What may be learned: plain names and short labels only. */
export type LearnedTerm = { kind: MemoryKind; value: string; alias?: string | null; detail?: string | null };
export type MemoryTerm = { id: string; kind: MemoryKind; value: string; alias: string | null; detail: string | null; source: MemorySource; uses: number; lastSeen: string };
/** What the planner is given: never ids, sources or counts. */
export type MemoryHint = { kind: MemoryKind; value: string; alias: string | null; detail: string | null };

/** Text from other people (issue titles, event titles) becomes a short single line: no control characters, no line breaks. */
export function clean(text: unknown, max: number): string | null {
  if (typeof text !== 'string') return null;
  const value = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return value || null;
}
const isKind = (kind: unknown): kind is MemoryKind => (MEMORY_KINDS as readonly string[]).includes(String(kind));

async function enabled(db: Queryable, ownerId: string): Promise<boolean> {
  const row = (await db.query('SELECT memory_enabled FROM users WHERE id=$1', [ownerId])).rows[0];
  return row ? row.memory_enabled !== false : true;
}

/**
 * Adds what a lookup, an approved action or the user's own words revealed. It never reads anything itself: callers pass
 * names that were already read for the user. Returns how many entries are new. Nothing is stored while learning is off.
 */
export async function learnTerms(db: Queryable, ownerId: string, terms: LearnedTerm[], source: MemorySource): Promise<number> {
  if (!terms.length || !(await enabled(db, ownerId))) return 0;
  const seen = new Set<string>();
  let added = 0;
  for (const term of terms.slice(0, 60)) {
    if (!isKind(term.kind)) continue;
    const value = clean(term.value, MEMORY_LIMITS.value);
    if (!value) continue;
    const key = `${term.kind}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const result = await db.query(
      `INSERT INTO memory_terms(id,owner_id,kind,value,alias,detail,source) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (owner_id,kind,(lower(value))) DO UPDATE SET last_seen=now(), alias=COALESCE(EXCLUDED.alias,memory_terms.alias), detail=COALESCE(EXCLUDED.detail,memory_terms.detail)
       RETURNING (xmax = 0) AS inserted`,
      [randomUUID(), ownerId, term.kind, value, clean(term.alias, MEMORY_LIMITS.alias), clean(term.detail, MEMORY_LIMITS.detail), source]);
    if (result.rows[0]?.inserted) added++;
  }
  // Over the cap, the least used and oldest go first; entries the user wrote themselves are kept longest.
  await db.query(`DELETE FROM memory_terms WHERE id IN (SELECT id FROM memory_terms WHERE owner_id=$1 ORDER BY (source='manual') DESC, uses DESC, last_seen DESC OFFSET $2)`, [ownerId, MEMORY_LIMITS.entries]);
  return added;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'all', 'show', 'list', 'what', 'who', 'how', 'when', 'from', 'that', 'this', 'them', 'they', 'are', 'was', 'you', 'your', 'can', 'please', 'move', 'send', 'email', 'create', 'delete', 'status', 'issue', 'issues', 'story', 'stories', 'meeting', 'calendar', 'jira', 'epic', 'project', 'about', 'into', 'have', 'has', 'new', 'tomorrow', 'today', 'yesterday', 'next', 'week', 'done', 'doing', 'yes', 'not']);
const words = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’._-]*/gu) ?? []).map(w => w.replace(/^['’._-]+|['’._-]+$/g, '')).filter(w => w.length >= 3 && !STOP.has(w));

/**
 * The few entries that matter for this message (and the user's previous one), best first, as hints for the planner. Entries
 * that are used count as used, so what you refer to often stays and what you never use is the first to go.
 */
export async function relevantTerms(db: Queryable, ownerId: string, texts: string[]): Promise<MemoryHint[]> {
  if (!(await enabled(db, ownerId))) return [];
  const tokens = new Set(texts.flatMap(words));
  if (!tokens.size) return [];
  const haystack = texts.join(' ').toLowerCase();
  const rows = (await db.query('SELECT id,kind,value,alias,detail,uses FROM memory_terms WHERE owner_id=$1', [ownerId])).rows as { id: string; kind: MemoryKind; value: string; alias: string | null; detail: string | null; uses: number }[];
  const scored = rows.map(r => {
    const value = r.value.toLowerCase(), alias = (r.alias ?? '').toLowerCase(), detail = (r.detail ?? '').toLowerCase();
    let score = 0;
    if (alias && (tokens.has(alias) || haystack.includes(alias))) score = Math.max(score, 4);
    if (value.length >= 3 && haystack.includes(value)) score = Math.max(score, 4);
    if (words(r.value).some(w => tokens.has(w))) score = Math.max(score, 3);
    if (detail && words(detail).some(w => tokens.has(w))) score = Math.max(score, 1);
    return { r, score };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score || b.r.uses - a.r.uses).slice(0, MEMORY_LIMITS.relevant);
  if (scored.length) await db.query('UPDATE memory_terms SET uses=uses+1, last_seen=now() WHERE owner_id=$1 AND id = ANY($2::text[])', [ownerId, scored.map(s => s.r.id)]);
  return scored.map(({ r }) => ({ kind: r.kind, value: r.value, alias: r.alias, detail: r.detail }));
}

export function createMemoryStore(db: Queryable) {
  const toTerm = (r: Record<string, unknown>): MemoryTerm => ({ id: String(r.id), kind: r.kind as MemoryKind, value: String(r.value), alias: (r.alias as string | null) ?? null, detail: (r.detail as string | null) ?? null, source: r.source as MemorySource, uses: Number(r.uses), lastSeen: new Date(r.last_seen as string).toISOString() });
  return {
    learn: (ownerId: string, terms: LearnedTerm[], source: MemorySource) => learnTerms(db, ownerId, terms, source),
    relevant: (ownerId: string, texts: string[]) => relevantTerms(db, ownerId, texts),
    enabled: (ownerId: string) => enabled(db, ownerId),
    async view(ownerId: string): Promise<{ enabled: boolean; terms: MemoryTerm[] }> {
      const rows = (await db.query('SELECT id,kind,value,alias,detail,source,uses,last_seen FROM memory_terms WHERE owner_id=$1 ORDER BY kind, lower(value)', [ownerId])).rows;
      return { enabled: await enabled(db, ownerId), terms: rows.map(toTerm) };
    },
    async setEnabled(ownerId: string, on: boolean) { await db.query('INSERT INTO users(id,memory_enabled) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET memory_enabled=EXCLUDED.memory_enabled', [ownerId, on]); },
    /** The user's own entry: kept above everything learned automatically. */
    async add(ownerId: string, term: LearnedTerm): Promise<MemoryTerm | null> {
      const value = clean(term.value, MEMORY_LIMITS.value);
      if (!value || !isKind(term.kind)) return null;
      await db.query('INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [ownerId]);
      const row = (await db.query(
        `INSERT INTO memory_terms(id,owner_id,kind,value,alias,detail,source) VALUES ($1,$2,$3,$4,$5,$6,'manual')
         ON CONFLICT (owner_id,kind,(lower(value))) DO UPDATE SET alias=EXCLUDED.alias, detail=EXCLUDED.detail, source='manual', last_seen=now()
         RETURNING id,kind,value,alias,detail,source,uses,last_seen`, [randomUUID(), ownerId, term.kind, value, clean(term.alias, MEMORY_LIMITS.alias), clean(term.detail, MEMORY_LIMITS.detail)])).rows[0];
      return toTerm(row);
    },
    async update(ownerId: string, id: string, patch: { value: string; alias?: string | null; detail?: string | null }): Promise<MemoryTerm | null> {
      const value = clean(patch.value, MEMORY_LIMITS.value);
      if (!value) return null;
      try {
        const row = (await db.query(`UPDATE memory_terms SET value=$3, alias=$4, detail=$5, source='manual' WHERE owner_id=$1 AND id=$2 RETURNING id,kind,value,alias,detail,source,uses,last_seen`, [ownerId, id, value, clean(patch.alias, MEMORY_LIMITS.alias), clean(patch.detail, MEMORY_LIMITS.detail)])).rows[0];
        return row ? toTerm(row) : null;
      } catch { return null; }
    },
    async remove(ownerId: string, id: string): Promise<boolean> {
      const gone = (await db.query('DELETE FROM memory_terms WHERE owner_id=$1 AND id=$2 RETURNING kind,value,alias', [ownerId, id])).rows[0] as { kind: string; value: string; alias: string | null } | undefined;
      // A correction the user deleted must not come straight back from what was already seen.
      if (gone?.kind === 'correction' && gone.alias) await db.query('DELETE FROM memory_corrections_seen WHERE owner_id=$1 AND spoken=lower($2) AND lower(written)=lower($3)', [ownerId, gone.alias, gone.value]).catch(() => undefined);
      return Boolean(gone);
    },
    async clear(ownerId: string): Promise<number> {
      await db.query('DELETE FROM memory_corrections_seen WHERE owner_id=$1', [ownerId]).catch(() => undefined);
      return (await db.query('DELETE FROM memory_terms WHERE owner_id=$1 RETURNING id', [ownerId])).rows.length;
    },
    /**
     * What dictation needs: the user's spoken-form corrections, and a short vocabulary prompt for the transcription model.
     * Both are empty while learning is off.
     */
    async dictation(ownerId: string): Promise<{ enabled: boolean; corrections: Correction[]; prompt: string }> {
      if (!(await enabled(db, ownerId))) return { enabled: false, corrections: [], prompt: '' };
      const rows = (await db.query('SELECT kind,value,alias,detail FROM memory_terms WHERE owner_id=$1 ORDER BY uses DESC, last_seen DESC', [ownerId])).rows as MemoryHint[];
      const seen = new Set<string>();
      const corrections: Correction[] = [];
      // Most used (then most recent) wins when two entries share a spoken form.
      for (const r of (await db.query("SELECT value,alias FROM memory_terms WHERE owner_id=$1 AND kind='correction' AND alias IS NOT NULL ORDER BY last_seen DESC", [ownerId])).rows as { value: string; alias: string }[]) {
        if (seen.has(r.alias.toLowerCase())) continue;
        seen.add(r.alias.toLowerCase()); corrections.push({ from: r.alias, to: r.value });
      }
      return { enabled: true, corrections, prompt: vocabularyPrompt(rows.slice(0, 80)) };
    },
    /**
     * The user edited dictated text before sending. Words changed into look-alike words are counted, and a change seen in two
     * separate messages becomes a spoken-form correction. Returns how many corrections are new.
     */
    async observeEdit(ownerId: string, dictated: string, final: string): Promise<number> {
      if (!(await enabled(db, ownerId))) return 0;
      let learned = 0;
      for (const pair of replacementPairs(dictated, final).slice(0, 5)) {
        const row = (await db.query(
          `INSERT INTO memory_corrections_seen(owner_id,spoken,written) VALUES ($1,lower($2),$3)
           ON CONFLICT (owner_id,spoken,written) DO UPDATE SET seen=memory_corrections_seen.seen+1, last_seen=now() RETURNING seen`, [ownerId, pair.from, pair.to])).rows[0] as { seen: number };
        if (row.seen >= 2) learned += await learnTerms(db, ownerId, [{ kind: 'correction', value: pair.to, alias: pair.from }], 'chat');
      }
      return learned;
    },
  };
}
export type MemoryStore = ReturnType<typeof createMemoryStore>;
