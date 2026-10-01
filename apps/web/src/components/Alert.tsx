import type { ReactNode } from 'react';

export type AlertTone = 'success' | 'warning' | 'error' | 'info';

/** A status message. Errors are announced immediately (role="alert"); other tones politely (role="status"). */
export function Alert({ tone = 'info', children }: { tone?: AlertTone; children: ReactNode }) {
  return <p className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>;
}
