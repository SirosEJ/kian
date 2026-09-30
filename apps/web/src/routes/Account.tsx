import { useState } from 'react';
import { apiRequest } from '../api.js';

export function Account({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true); setError('');
    try { await apiRequest('/account', 'DELETE', { confirm: 'DELETE' }); onDeleted(); }
    catch { setError('Could not finish deleting the account. Please try again.'); setBusy(false); }
  }

  return <section><h2>Account</h2>
    {!open ? <button onClick={() => setOpen(true)}>Delete my account</button> : <>
      <p>This permanently deletes your instructions, tasks, trusted actions, activity and stored connections, and removes your sign-in. Items already created in Google Calendar, Jira or email are not undone.</p>
      <label>Type DELETE to confirm<input value={typed} onChange={event => setTyped(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="actions"><button disabled={busy || typed !== 'DELETE'} onClick={() => void remove()}>Permanently delete account</button><button disabled={busy} onClick={() => { setOpen(false); setTyped(''); }}>Cancel</button></div>
    </>}
  </section>;
}
