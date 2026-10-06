import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest } from '../api.js';
import { Alert, Button } from '../components/index.js';

export type MailPresetInfo = { id: string; label: string; host: string | null; port: number; security: 'ssl' | 'starttls'; appPassword: boolean; help: string };

/** Connects any mailbox: pick the provider, enter the address and its (app) password. "Other server" asks for the server details too. */
export function MailSettings({ onUpdated, initialPresets }: { onUpdated: () => Promise<void>; initialPresets?: MailPresetInfo[] }) {
  const [presets, setPresets] = useState<MailPresetInfo[]>(initialPresets ?? []);
  const [presetId, setPresetId] = useState('gmail');
  const [user, setUser] = useState(''), [password, setPassword] = useState('');
  const [host, setHost] = useState(''), [port, setPort] = useState(587), [security, setSecurity] = useState<'ssl' | 'starttls'>('starttls');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (!initialPresets) void apiRequest('/connections/mailbox/presets').then(setPresets).catch(() => setError('Could not load the list of email providers. Reload the page.')); }, [initialPresets]);
  const preset = presets.find(p => p.id === presetId);
  const other = presetId === 'other';

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await apiRequest('/connections/mailbox', 'POST', { preset: presetId, user, password, ...(other ? { host, port, security } : {}) });
      setPassword(''); await onUpdated();
    } catch (e) { setError((e as { status?: number }).status === 422 ? (e as Error).message : 'Could not connect. Check the provider, the address and the password.'); }
    finally { setBusy(false); }
  }
  function choose(id: string) { setPresetId(id); setError(''); const next = presets.find(p => p.id === id); if (next) { setPort(next.port); setSecurity(next.security); } }

  return <form onSubmit={event => void submit(event)}>
    <h4>Connect email</h4>
    <label>Email provider<select value={presetId} onChange={e => choose(e.target.value)}>{presets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
    {preset && <p className="muted">{preset.help}</p>}
    {other && <>
      <label>Outgoing mail server (SMTP)<input required value={host} onChange={e => setHost(e.target.value)} placeholder="smtp.example.com" autoComplete="off" /></label>
      <label>Port<select value={port} onChange={e => { const p = Number(e.target.value); setPort(p); setSecurity(p === 465 ? 'ssl' : 'starttls'); }}><option value={587}>587 (STARTTLS)</option><option value={465}>465 (SSL)</option><option value={2587}>2587 (STARTTLS)</option><option value={25}>25 (STARTTLS)</option></select></label>
    </>}
    <label>Email address<input type="email" required value={user} onChange={e => setUser(e.target.value)} autoComplete="off" /></label>
    <label>{preset?.appPassword ? 'App password' : 'Mailbox password'}<input type="password" autoComplete="off" required value={password} onChange={e => setPassword(e.target.value)} /></label>
    <Button type="submit" disabled={busy || !preset}>Test and save mailbox</Button>
    {error && <Alert tone="error">{error}</Alert>}
  </form>;
}
