import { describe, expect, it } from 'vitest';
import tokens from './tokens.json';
import { buildThemeCss, themeVariables } from './css.js';

describe('theme CSS variables', () => {
  const vars = themeVariables(tokens);

  it('exposes the core palette, resolving semantic references to hex values', () => {
    expect(vars['--palette-navy-900']).toBe('#07132F');
    expect(vars['--palette-cyan-500']).toBe('#01B6DF');
    expect(vars['--bg-page']).toBe('#F1F6F9');
    expect(vars['--text-link']).toBe('#017A96');
    expect(vars['--action-primary-bg']).toBe('#01B6DF');
    expect(vars['--action-primary-text']).toBe('#07132F');
    expect(vars['--border-input']).toBe('#7C8DA8');
    expect(vars['--status-success-bg']).toBe('#E7F5EE');
    expect(vars['--state-recording']).toBe('#DC2626');
  });

  it('exposes typography, radius, shadow and spacing', () => {
    expect(vars['--font-sans']).toContain('Inter');
    expect(vars['--font-serif']).toContain('Fraunces');
    expect(vars['--font-size-base']).toBe('1rem');
    expect(vars['--line-height-normal']).toBe('1.5');
    expect(vars['--radius-md']).toBe('12px');
    expect(vars['--shadow-raised']).toContain('rgba(7, 19, 47, 0.14)');
    expect(vars['--space-4']).toBe('16px');
  });

  it('leaves out documentation-only sections and the optional dark theme by default', () => {
    expect(Object.keys(vars).some(name => /note|meta|contrast|logo|dark/.test(name))).toBe(false);
    expect(Object.values(vars).some(value => value.startsWith('{'))).toBe(false);
  });

  it('emits one :root block that says it is generated', () => {
    const css = buildThemeCss(tokens);
    expect(css).toMatch(/^\/\* Generated from src\/theme\/tokens\.json/);
    expect(css.match(/:root\s*{/g)).toHaveLength(1);
    expect(css).toContain('--bg-page: #F1F6F9;');
  });

  it('can emit the dark theme under [data-theme="dark"] when asked', () => {
    const css = buildThemeCss(tokens, { includeDark: true });
    expect(css).toMatch(/\[data-theme="dark"\]\s*{[^}]*--bg-page: #07132F;/);
  });

  it('fails loudly on a reference that does not exist', () => {
    const broken = { color: { core: {}, light: { bg: { page: '{color.core.nope}' } } } };
    expect(() => buildThemeCss(broken)).toThrow(/nope/);
  });
});
