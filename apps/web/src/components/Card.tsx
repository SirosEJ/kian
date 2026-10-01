import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={`panel ${className}`.trim()} {...rest} />;
}
