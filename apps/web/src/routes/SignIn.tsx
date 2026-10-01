import { useState, type FormEvent } from 'react';
import { Alert, Button, Logo } from '../components/index.js';

export function SignIn({ onSubmit, initialMode = 'in' }: { onSubmit: (email: string, password: string, mode: 'in' | 'up') => Promise<void>; initialMode?: 'in' | 'up' }) {
  const [mode, setMode] = useState<'in' | 'up'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signingUp = mode === 'up';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (signingUp && password !== confirm) { setError('The passwords do not match.'); return; }
    setError(''); setBusy(true);
    try { await onSubmit(email, password, mode); }
    catch { setError(signingUp ? 'Could not create the account. The email may already be registered; try signing in.' : 'Could not sign in. Check your email and password, or create an account.'); }
    finally { setBusy(false); }
  }

  function switchMode() { setMode(signingUp ? 'in' : 'up'); setError(''); setConfirm(''); }

  return <main className="card">
    <Logo /><h1>Kian</h1><p className="muted">Your personal organiser</p>
    <h2>{signingUp ? 'Create your account' : 'Sign in'}</h2>
    {signingUp && <p>Your instructions, connected services and activity are private to your account. Use at least 8 characters for your password.</p>}
    <form onSubmit={submit}>
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" autoComplete={signingUp ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={event => setPassword(event.target.value)} /></label>
      {signingUp && <label>Confirm password<input type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={event => setConfirm(event.target.value)} /></label>}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="actions"><Button disabled={busy} type="submit">{signingUp ? 'Create account' : 'Sign in'}</Button><Button variant="ghost" disabled={busy} type="button" onClick={switchMode}>{signingUp ? 'I already have an account' : 'Create account'}</Button></div>
    </form>
  </main>;
}
