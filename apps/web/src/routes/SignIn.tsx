import { useState, type FormEvent } from 'react';

export function SignIn({ onSubmit }: { onSubmit: (email: string, password: string, mode: 'in' | 'up') => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function perform(mode: 'in' | 'up') {
    setError(''); setBusy(true);
    try { await onSubmit(email, password, mode); }
    catch { setError('Could not access the account. Check the details and try again.'); }
    finally { setBusy(false); }
  }

  return <main className="card">
    <h1>Kian</h1><p>Your personal organiser</p>
    <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void perform('in'); }}>
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={event => setPassword(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="actions"><button disabled={busy} type="submit">Sign in</button><button disabled={busy} type="button" onClick={() => void perform('up')}>Create account</button></div>
    </form>
  </main>;
}
