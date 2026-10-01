import { useState } from 'react';
import { apiRequest } from '../api.js';
import { Alert, Button } from '../components/index.js';

export function Account({ email, onDeleted }: { email?: string | null; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true); setError('');
    try { await apiRequest('/account', 'DELETE', { confirm: 'DELETE' }); onDeleted(); }
    catch { setError('Could not finish deleting the account. Please try again.'); setBusy(false); }
  }

  return <section><h2>Account</h2>{email && <p>Signed in as <strong>{email}</strong></p>}
    {!open ? <Button variant="destructive" onClick={() => setOpen(true)}>Delete my account</Button> : <>
      <p>This permanently deletes your instructions, tasks, trusted actions, activity and stored connections, and removes your sign-in. Items already created in Google Calendar, Jira or email are not undone.</p>
      <label>Type DELETE to confirm<input value={typed} onChange={event => setTyped(event.target.value)} /></label>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="actions"><Button variant="destructive" disabled={busy || typed !== 'DELETE'} onClick={() => void remove()}>Permanently delete account</Button><Button variant="ghost" disabled={busy} onClick={() => { setOpen(false); setTyped(''); }}>Cancel</Button></div>
    </>}
  </section>;
}
