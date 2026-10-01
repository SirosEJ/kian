import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { build } from 'vite';

const webRoot = fileURLToPath(new URL('../..', import.meta.url));

describe('token build integration', () => {
  it('puts the brand tokens into the compiled stylesheet of the real app build', async () => {
    const result = await build({ root: webRoot, logLevel: 'silent', build: { write: false, outDir: 'dist-test' } });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => ('output' in item ? item.output : []));
    const css = outputs.filter(file => file.fileName.endsWith('.css')).map(file => ('source' in file ? String(file.source) : '')).join('\n');
    expect(css).toMatch(/--palette-navy-900:\s*#07132f/i);
    expect(css).toMatch(/--palette-cyan-500:\s*#01b6df/i);
    expect(css).toMatch(/--bg-page:\s*#f1f6f9/i);
    expect(css).toMatch(/--action-primary-text:\s*#07132f/i);
    expect(css).toMatch(/--font-serif:[^;}]*Fraunces/);
    expect(css).not.toContain('data-theme');
  }, 60000);
});
