import tokens from './tokens.json';

/** The token file, for code that needs a value at runtime (most styling should use the CSS variables instead). */
export { tokens };

/** `cssVar('bg-page')` gives `var(--bg-page)` for inline styles. Variable names are listed in docs/design/brand-tokens.md. */
export const cssVar = (name: string): string => `var(--${name})`;
