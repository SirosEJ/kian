import type { ReactNode } from 'react';
import { Logo } from '../components/Logo.js';
import { Link } from './Link.js';
import { ProfileMenu } from './ProfileMenu.js';
import type { Page } from './routing.js';

const navigation: { to: Page; label: string }[] = [{ to: '/', label: 'Home' }, { to: '/activity', label: 'Activity' }];

/** The signed-in frame: logo, main navigation and the profile menu on top, the page below. */
export function AppShell({ email, page, onSignOut, children }: { email: string | null; page: Page | null; onSignOut: () => void; children: ReactNode }) {
  return <div className={page === '/' ? 'shell shell-chat' : 'shell'}>
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand" aria-label="Kian home"><Logo width={200} /></Link>
        <nav className="nav" aria-label="Main">
          {navigation.map(item => <Link key={item.to} to={item.to} aria-current={page === item.to ? 'page' : undefined}>{item.label}</Link>)}
        </nav>
        <ProfileMenu email={email} onSignOut={onSignOut} />
      </div>
    </header>
    <main className="page">{children}</main>
  </div>;
}
