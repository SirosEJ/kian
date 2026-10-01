import { describe, expect, it } from 'vitest';
import tokens from './tokens.json';

type Node = { [key: string]: Node | string | number };
const root = tokens as unknown as Node;

function lookup(path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Node | undefined)?.[key], root.color);
}
function resolve(path: string): string {
  let value = lookup(path);
  for (let hops = 0; typeof value === 'string' && value.startsWith('{') && hops < 5; hops++) value = lookup(value.slice(1, -1).replace(/^color\./, ''));
  if (typeof value === 'object' && value !== null && 'value' in value) value = (value as { value: string }).value;
  if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value)) throw new Error(`Cannot resolve token ${path}`);
  return value;
}
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

describe('brand tokens', () => {
  it('uses the Sepenta brand colours from the logo and website', () => {
    expect(resolve('core.navy-900')).toBe('#07132F');
    expect(resolve('core.cyan-500')).toBe('#01B6DF');
  });

  it('resolves every semantic token to a hex colour', () => {
    const walk = (node: Node, path: string[]): string[] => Object.entries(node).flatMap(([key, value]) => key.startsWith('_') ? [] : typeof value === 'object' ? walk(value, [...path, key]) : [[...path, key].join('.')]);
    const paths = [...walk((root.color as Node).light as Node, ['light']), ...walk((root.color as Node).dark as Node, ['dark'])];
    expect(paths.length).toBeGreaterThan(20);
    for (const path of paths) expect(resolve(path)).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('meets the proposed WCAG contrast target for every listed pair', () => {
    const pairs = root.contrast as unknown as { fg: string; bg: string; min: number; role: string }[];
    expect(pairs.length).toBeGreaterThan(25);
    for (const { fg, bg, min, role } of pairs) {
      const actual = ratio(resolve(fg), resolve(bg));
      expect(actual, `${role}: ${fg} on ${bg} is ${actual.toFixed(2)}:1, needs ${min}:1`).toBeGreaterThanOrEqual(min);
    }
  });

  it('keeps the known failing combinations out of the proposal', () => {
    expect(ratio('#FFFFFF', resolve('core.cyan-500'))).toBeLessThan(3);
    expect(ratio(resolve('core.cyan-500'), resolve('core.white'))).toBeLessThan(3);
    expect(ratio('#BDC8D5', resolve('core.white'))).toBeLessThan(3);
  });
});
