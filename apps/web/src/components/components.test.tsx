import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Alert, Button, Card, Logo } from './index.js';
import { Gallery } from './Gallery.js';

describe('token-driven components', () => {
  it('renders every button variant with its class, and defaults to a non-submitting primary button', () => {
    const html = renderToString(<><Button>A</Button><Button variant="secondary">B</Button><Button variant="destructive">C</Button><Button variant="ghost">D</Button></>);
    for (const variant of ['primary', 'secondary', 'destructive', 'ghost']) expect(html).toContain(`btn-${variant}`);
    expect(html).toContain('type="button"');
  });

  it('announces errors immediately and other messages politely', () => {
    expect(renderToString(<Alert tone="error">x</Alert>)).toContain('role="alert"');
    for (const tone of ['success', 'warning', 'info'] as const) expect(renderToString(<Alert tone={tone}>x</Alert>)).toContain('role="status"');
  });

  it('shows the Sepenta logo in both approved variants and never below the minimum width', () => {
    const light = renderToString(<Logo />), dark = renderToString(<Logo variant="dark" />);
    expect(light).toMatch(/src="[^"]*sepenta-logo-light-bg[^"]*"/);
    expect(dark).toMatch(/src="[^"]*sepenta-logo-dark-bg[^"]*"/);
    expect(light).toContain('alt="Sepenta: Powering Intelligent Growth"');
    expect(renderToString(<Logo width={80} />)).toContain('width:160px');
  });

  it('wraps content in a card panel', () => {
    expect(renderToString(<Card>hello</Card>)).toContain('class="panel"');
  });

  it('gallery shows the logo on light and navy, the palette, all buttons and all message tones', () => {
    const html = renderToString(<Gallery />);
    expect(html.match(/<img[^>]*sepenta-logo-light-bg/g)).toHaveLength(1);
    expect(html.match(/<img[^>]*sepenta-logo-dark-bg/g)).toHaveLength(1);
    expect(html).toContain('var(--palette-cyan-500)');
    expect(html).toContain('var(--palette-navy-900)');
    for (const variant of ['primary', 'secondary', 'destructive', 'ghost']) expect(html).toContain(`btn-${variant}`);
    for (const tone of ['success', 'warning', 'error', 'info']) expect(html).toContain(`alert-${tone}`);
  });
});

describe('stylesheet', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

  it('contains no raw colour values, only token variables', () => {
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(css.match(/\b(?:rgb|rgba|hsl|hsla)\(/g)).toBeNull();
  });

  it('only references variables that the token build defines', async () => {
    const { themeVariables } = await import('../theme/css.js');
    const tokens = (await import('../theme/tokens.json')).default;
    const defined = new Set(Object.keys(themeVariables(tokens)));
    const used = [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(match => match[1]);
    expect(used.length).toBeGreaterThan(40);
    expect(used.filter(name => !defined.has(name))).toEqual([]);
  });

  it('lets the message tone classes override the default look of role="alert" and role="status" paragraphs', () => {
    // Attribute selectors would beat the single-class tone rules, so they must be wrapped in :where().
    expect(css).toMatch(/:where\(p\[role="alert"\]\)/);
    expect(css).toMatch(/:where\(p\[role="status"\]:not\(\.prompt-status\)\)/);
    expect(css.replace(/:where\([^)]*\)\)?/g, '')).not.toMatch(/(^|[,}\s])p\[role=/m);
  });
});

