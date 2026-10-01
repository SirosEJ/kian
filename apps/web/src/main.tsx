import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SignIn } from './routes/SignIn.js';
import { signOutUser, submitCredentials, watchUser } from './auth.js';
import { Dashboard } from './routes/Dashboard.js';
import { Activity } from './routes/Activity.js';
import { Account } from './routes/Account.js';
import { Settings } from './routes/Settings.js';
import { Gallery } from './components/Gallery.js';
import { Logo } from './components/Logo.js';
import { AppShell } from './layout/AppShell.js';
import { Link } from './layout/Link.js';
import { applyCallbackRedirect, pageTitles, useRoute } from './layout/routing.js';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/fraunces/wght.css';
import 'virtual:kian-theme.css';
import './style.css';

function NotFound() {
  return <section><h2>Page not found</h2><p>That page does not exist. <Link to="/">Go to Home</Link></p></section>;
}

function App() {
  const [user, setUser] = useState<{ email: string | null } | null>(null);
  const [configurationError, setConfigurationError] = useState('');
  const page = useRoute();
  useEffect(() => {
    try { return watchUser(account => setUser(account)); }
    catch { setConfigurationError('Account sign-in is not configured yet.'); }
  }, []);
  useEffect(() => { document.title = user ? `${page ? pageTitles[page] : 'Page not found'} · Kian` : 'Kian'; }, [page, user]);
  if (configurationError) return <main className="card"><Logo /><h1>Kian</h1><p role="alert">{configurationError}</p></main>;
  if (!user) return <SignIn onSubmit={submitCredentials} />;
  return <AppShell email={user.email} page={page} onSignOut={() => { void signOutUser(); }}>
    {page === '/' && <Dashboard />}
    {page === '/activity' && <Activity />}
    {page === '/settings' && <Settings />}
    {page === '/account' && <Account email={user.email} onDeleted={() => { void signOutUser(); }} />}
    {page === null && <NotFound />}
  </AppShell>;
}

// `?components` shows the component gallery without signing in.
function Root() { return new URLSearchParams(window.location.search).has('components') ? <Gallery /> : <App />; }

applyCallbackRedirect();
createRoot(document.getElementById('root')!).render(<React.StrictMode><Root /></React.StrictMode>);
