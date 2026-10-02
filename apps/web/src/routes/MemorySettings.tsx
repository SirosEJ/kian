import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { Alert, Button, Card } from '../components/index.js';

export type MemoryItem = { id: string; kind: string; value: string; alias: string | null; detail: string | null; source: string };
const kindNames: Record<string, string> = { person: 'People', project: 'Projects', epic: 'Epics', calendar: 'Calendars', meeting: 'Meetings', correction: 'Spoken corrections' };
const sourceNames: Record<string, string> = { jira: 'from Jira', calendar: 'from your calendar', email: 'from an email you sent', chat: 'from what you told Kian', manual: 'added by you' };
const kindOrder = ['person', 'project', 'epic', 'calendar', 'meeting', 'correction'];

/** Groups the entries by kind in a fixed, readable order. */
export function groupMemory(terms: MemoryItem[]): { kind: string; name: string; items: MemoryItem[] }[] {
  return kindOrder.map(kind => ({ kind, name: kindNames[kind], items: terms.filter(t => t.kind === kind) })).filter(g => g.items.length > 0);
}
export const describeEntry = (t: MemoryItem) => [t.alias ? (t.kind === 'correction' ? `you say "${t.alias}"` : `also "${t.alias}"`) : '', t.detail ?? '', sourceNames[t.source] ?? ''].filter(Boolean).join(' · ');

/** "What Kian remembers": every entry can be corrected or deleted, and learning can be switched off. */
export function MemorySettings({ initial }: { initial?: { enabled: boolean; terms: MemoryItem[] } }) {
  const [state, setState] = useState<{ enabled: boolean; terms: MemoryItem[] } | null>(initial ?? null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ value: '', alias: '', detail: '' });
  const [adding, setAdding] = useState({ kind: 'person', value: '', alias: '' });
  const [confirmClear, setConfirmClear] = useState(false);
  async function reload() { setState(await apiRequest('/memory')); }
  useEffect(() => { if (!initial) void reload().catch(() => setError('Could not load what Kian remembers.')); }, []);
  async function run(action: () => Promise<unknown>, failure: string) { setError(''); try { await action(); await reload(); } catch { setError(failure); } }
  const groups = groupMemory(state?.terms ?? []);
  return <Card>
    <h3>What Kian remembers</h3>
    <p className="muted">Names, projects and epics that Kian has seen in your Jira, your calendar and emails you sent, and fixes you make to words you dictated, so it understands "Sol" or "the onboarding epic". Dictation uses the same list to spell your names right. Only you can see this. It is deleted with your account. It is never read from email bodies or event descriptions.</p>
    {error && <Alert tone="error">{error}</Alert>}
    {state && <label className="checkbox"><input type="checkbox" checked={state.enabled} onChange={e => void run(() => apiRequest('/memory/enabled', 'PUT', { enabled: e.target.checked }), 'Could not change that setting.')} />Let Kian learn and use what it remembers</label>}
    {state && !state.enabled && <p className="muted">Learning is off: Kian remembers nothing new and does not use these entries until you turn it back on.</p>}
    {state && groups.length === 0 && <p>Nothing yet. Ask Kian about your Jira issues or calendar and the names it finds will appear here.</p>}
    {groups.map(g => <section key={g.kind}><h4>{g.name}</h4><ul className="list">{g.items.map(t => <li key={t.id}>{editing === t.id ? <>
      <label>Name<input value={draft.value} onChange={e => setDraft({ ...draft, value: e.target.value })} /></label>
      <label>{t.kind === 'correction' ? 'What you say' : 'Nickname'}<input value={draft.alias} onChange={e => setDraft({ ...draft, alias: e.target.value })} /></label>
      <label>Note<input value={draft.detail} onChange={e => setDraft({ ...draft, detail: e.target.value })} /></label>
      <div className="actions"><Button disabled={!draft.value.trim()} onClick={() => void run(async () => { await apiRequest(`/memory/${encodeURIComponent(t.id)}`, 'PUT', { value: draft.value, alias: draft.alias || null, detail: draft.detail || null }); setEditing(null); }, 'Could not save that. Another entry may already have that name.')}>Save</Button><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
    </> : <>
      <strong>{t.value}</strong><p className="muted">{describeEntry(t)}</p>
      <div className="actions"><Button variant="ghost" onClick={() => { setDraft({ value: t.value, alias: t.alias ?? '', detail: t.detail ?? '' }); setEditing(t.id); }}>Edit</Button><Button variant="ghost" onClick={() => void run(() => apiRequest(`/memory/${encodeURIComponent(t.id)}`, 'DELETE'), 'Could not delete that.')}>Delete</Button></div>
    </>}</li>)}</ul></section>)}
    <h4>Add something yourself</h4>
    <div className="actions">
      <select aria-label="Kind" value={adding.kind} onChange={e => setAdding({ ...adding, kind: e.target.value })}>{kindOrder.map(k => <option key={k} value={k}>{kindNames[k]}</option>)}</select>
      <input aria-label="Name" placeholder="Name" value={adding.value} onChange={e => setAdding({ ...adding, value: e.target.value })} />
      <input aria-label="Nickname" placeholder="Nickname or what you say" value={adding.alias} onChange={e => setAdding({ ...adding, alias: e.target.value })} />
      <Button variant="secondary" disabled={!adding.value.trim()} onClick={() => void run(async () => { await apiRequest('/memory', 'POST', { kind: adding.kind, value: adding.value, alias: adding.alias || null }); setAdding({ kind: adding.kind, value: '', alias: '' }); }, 'Could not add that.')}>Add</Button>
    </div>
    {state && state.terms.length > 0 && (confirmClear
      ? <div className="actions"><p>Delete everything Kian remembers about you?</p><Button onClick={() => void run(async () => { await apiRequest('/memory', 'DELETE'); setConfirmClear(false); }, 'Could not delete everything.')}>Yes, delete all</Button><Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button></div>
      : <Button variant="ghost" onClick={() => setConfirmClear(true)}>Delete everything Kian remembers</Button>)}
  </Card>;
}
