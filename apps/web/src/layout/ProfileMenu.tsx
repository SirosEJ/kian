import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from './Link.js';
import { initialOf, nextIndex } from './profile.js';

type Props = { email: string | null; onSignOut: () => void; defaultOpen?: boolean };

/** The profile avatar and the menu under it: Settings, Account, Sign out. Keyboard and screen-reader friendly. */
export function ProfileMenu({ email, onSignOut, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  function close(returnFocus: boolean) { setOpen(false); if (returnFocus) button.current?.focus(); }

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  function onMenuKey(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const all = items();
      const target = all[nextIndex(all.indexOf(document.activeElement as HTMLElement), all.length, event.key)];
      target?.focus();
    }
  }

  return <div className="profile" ref={root}>
    <button ref={button} type="button" className="avatar-button" aria-haspopup="menu" aria-expanded={open} aria-label={`Profile menu for ${email || 'your account'}`} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); } }}>{initialOf(email)}</button>
    {open && <div className="menu" role="menu" aria-label="Profile" onKeyDown={onMenuKey}>
      <p className="menu-email">{email}</p>
      <Link to="/settings" role="menuitem" onClick={() => close(false)}>Settings</Link>
      <Link to="/account" role="menuitem" onClick={() => close(false)}>Account</Link>
      <hr />
      <button type="button" role="menuitem" onClick={() => { close(false); onSignOut(); }}>Sign out</button>
    </div>}
  </div>;
}
