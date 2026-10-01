import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('.', import.meta.url));
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'assets' ? [] : sources(path);
    return /\.(ts|tsx|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('screens use the shared components and tokens', () => {
  const files = sources(root);

  it('has no raw colour values anywhere in the app source (the token file is the only place)', () => {
    const offenders = files.filter(file => /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/.test(readFileSync(file, 'utf8')));
    expect(offenders.map(file => file.replace(root, ''))).toEqual([]);
  });

  it('has no inline colour styling; colours only come through token variables', () => {
    const offenders = files.filter(file => /style=\{\{[^}]*\b(?:color|background|backgroundColor|borderColor)\s*:\s*['"`]/.test(readFileSync(file, 'utf8')));
    expect(offenders.map(file => file.replace(root, ''))).toEqual([]);
  });

  it('uses the Button component, not a raw <button>, on every screen', () => {
    const screens = files.filter(file => /\/routes\/[A-Za-z]+\.tsx$/.test(file));
    expect(screens.length).toBeGreaterThanOrEqual(8);
    const offenders = screens.filter(file => /<button[\s>]/.test(readFileSync(file, 'utf8')));
    expect(offenders.map(file => file.replace(root, ''))).toEqual([]);
  });

  it('shows messages with the Alert component, not hand-written role="alert" paragraphs', () => {
    const offenders = files.filter(file => /\/routes\//.test(file) && /<p[^>]*role="(alert|status)"/.test(readFileSync(file, 'utf8')));
    expect(offenders.map(file => file.replace(root, ''))).toEqual([]);
  });
});
