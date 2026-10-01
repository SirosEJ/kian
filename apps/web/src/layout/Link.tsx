import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { navigate } from './routing.js';

/** A link that changes page without reloading, but still works as a normal link (new tab, copy address, no JavaScript). */
export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  function handle(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || rest.target === '_blank') return;
    event.preventDefault();
    navigate(to);
  }
  return <a href={to} onClick={handle} {...rest} />;
}
