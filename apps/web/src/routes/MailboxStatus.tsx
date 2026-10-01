import { useState, type FormEvent } from 'react';
import { apiRequest } from '../api.js';
import { Alert, Button } from '../components/index.js';

export function MailboxStatus({ id, settings, onUpdated }: { id: string; settings: { mailbox?: string; host?: string }; onUpdated: () => Promise<void> }) {
  const [status, setStatus] = useState('');
  const [updating, setUpdating] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/connections/ionos/${encodeURIComponent(id)}`;

  async function test() {
    setBusy(true); setError(''); setStatus('');
    try {
      const result = await apiRequest(`${base}/test`, 'POST');
      if (result.ok) setStatus('Connected. The mailbox accepted the test.');
      else setError(result.message);
    } catch { setError('Could not test the mailbox. Try again.'); }
    finally { setBusy(false); }
  }

  async function update(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setStatus('');
    try { await apiRequest(base, 'PUT', { password }); setPassword(''); setUpdating(false); setStatus('Password updated and verified.'); await onUpdated(); }
    catch (e) { setError((e as { status?: number }).status === 422 ? (e as Error).message : 'Could not update the password. Try again.'); }
    finally { setBusy(false); }
  }

  return <div>
    <p>Mailbox: {settings.mailbox}{settings.host ? ` (${settings.host})` : ''}</p>
    <Button variant="secondary" disabled={busy} onClick={() => void test()}>Test connection</Button>
    <Button variant="ghost" disabled={busy} onClick={() => setUpdating(!updating)}>Update password</Button>
    {updating && <form onSubmit={event => void update(event)}><label>New mailbox password<input type="password" autoComplete="off" required value={password} onChange={event => setPassword(event.target.value)} /></label><Button disabled={busy}>Verify and save</Button></form>}
    {status && <Alert tone="success">{status}</Alert>}{error && <Alert tone="error">{error}</Alert>}
  </div>;
}
