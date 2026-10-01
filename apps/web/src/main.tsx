import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SignIn } from './routes/SignIn.js';
import { signOutUser, submitCredentials, watchUser } from './auth.js';
import { Dashboard } from './routes/Dashboard.js';
import { Activity } from './routes/Activity.js';
import { Account } from './routes/Account.js';
import { Settings } from './routes/Settings.js';
import 'virtual:kian-theme.css';
import './style.css';

function App() {
  const [user, setUser] = useState<{ email: string | null } | null>(null);
  const [configurationError, setConfigurationError] = useState('');
  useEffect(() => {
    try { return watchUser(account => setUser(account)); }
    catch { setConfigurationError('Account sign-in is not configured yet.'); }
  }, []);
  if (configurationError) return <main className="card"><h1>Kian</h1><p role="alert">{configurationError}</p></main>;
  if (!user) return <SignIn onSubmit={submitCredentials} />;
  return <main className="card"><h1>Kian</h1><p>Signed in as {user.email}</p><Dashboard /><Activity /><Settings /><Account onDeleted={() => { void signOutUser(); }} /><button onClick={() => signOutUser()}>Sign out</button></main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
