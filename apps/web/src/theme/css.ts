// Turns the brand token file into CSS custom properties. Pure so it can be tested and reused by the Vite plugin.
// Names: palette  --palette-<colour>   semantic  --<group>-<role> (e.g. --bg-page, --action-primary-bg)
//        type --font-*, --font-size-*, --line-height-*   shape --radius-*, --shadow-*, --space-*
type Node = { [key: string]: Node | string | number };
type Tokens = { color: Node; typography?: Node; radius?: Node; shadow?: Node; space?: Node };
export type ThemeVariables = Record<string, string>;

function lookup(root: Node, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Node)[key] : undefined), root);
}

function resolve(color: Node, value: unknown, label: string): string {
  let current = value;
  for (let hops = 0; typeof current === 'string' && current.startsWith('{'); hops++) {
    if (hops > 5) throw new Error(`Token reference loop at ${label}`);
    current = lookup(color, current.slice(1, -1).replace(/^color\./, ''));
    if (current === undefined) throw new Error(`Token ${label} refers to a missing token: ${String(value)}`);
  }
  if (typeof current === 'object' && current !== null && 'value' in current) current = (current as { value: unknown }).value;
  if (typeof current !== 'string' && typeof current !== 'number') throw new Error(`Token ${label} has no value`);
  return String(current);
}

function flatten(node: Node, path: string[] = []): [string[], unknown][] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (key.startsWith('_')) return [];
    if (typeof value === 'object' && value !== null && !('value' in value)) return flatten(value as Node, [...path, key]);
    return [[[...path, key], value] as [string[], unknown]];
  });
}

function group(prefix: string, node: Node | undefined, into: ThemeVariables) {
  if (!node) return;
  for (const [path, value] of flatten(node)) into[`--${prefix}-${path.join('-')}`] = String(value);
}

function themeColors(color: Node, theme: string): ThemeVariables {
  const out: ThemeVariables = {};
  for (const [path] of flatten(color[theme] as Node)) out[`--${path.join('-')}`] = resolve(color, lookup(color, `${theme}.${path.join('.')}`), `${theme}.${path.join('.')}`);
  return out;
}

export function themeVariables(tokens: unknown, options: { theme?: 'light' | 'dark' } = {}): ThemeVariables {
  const t = tokens as Tokens;
  const out: ThemeVariables = {};
  const theme = options.theme ?? 'light';
  if (theme === 'light') {
    for (const [path] of flatten(t.color.core as Node)) out[`--palette-${path.join('-')}`] = resolve(t.color, lookup(t.color, `core.${path.join('.')}`), `core.${path.join('.')}`);
    group('font', (t.typography?.family as Node) ?? undefined, out);
    group('font-size', t.typography?.size as Node, out);
    group('line-height', t.typography?.lineHeight as Node, out);
    group('radius', t.radius, out);
    group('shadow', t.shadow, out);
    group('space', t.space, out);
  }
  return Object.assign(out, themeColors(t.color, theme));
}

const block = (selector: string, vars: ThemeVariables) => `${selector} {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`;

/** The stylesheet the app imports as `virtual:kian-theme.css`. */
export function buildThemeCss(tokens: unknown, options: { includeDark?: boolean } = {}): string {
  const header = '/* Generated from src/theme/tokens.json. Do not edit; change the token file instead. */\n';
  const dark = options.includeDark ? block(':root[data-theme="dark"]', themeVariables(tokens, { theme: 'dark' })) : '';
  return `${header}${block(':root', themeVariables(tokens))}${dark}`;
}
