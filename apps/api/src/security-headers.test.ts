import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from './server.js';
import { contentSecurityPolicy, securityHeaderOptionsFromEnv, securityHeaders } from './security-headers.js';

const REQUIRED = ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'content-security-policy'];

describe('browser security headers (SFT-329)', () => {
  it('are on every kind of response: the page, a static file, the API, a refusal and a 404', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kian-web-'));
    await writeFile(join(dir, 'index.html'), '<html>Kian</html>');
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'assets', 'app.js'), 'console.log(1)');
    const app = buildServer({ webDistPath: dir, verifyToken: async () => { throw new Error('no'); } });
    const page = { accept: 'text/html' };
    const responses: [string, Awaited<ReturnType<typeof app.inject>>][] = [
      ['home', await app.inject({ url: '/', headers: page })],
      ['settings page', await app.inject({ url: '/settings', headers: page })],
      ['asset', await app.inject('/assets/app.js')],
      ['health', await app.inject('/health')],
      ['unauthorised API', await app.inject({ method: 'GET', url: '/tasks/x' })],
      ['not found', await app.inject('/nope')],
      ['missing asset', await app.inject('/assets/missing.js')],
    ];
    for (const [name, response] of responses) for (const header of REQUIRED) expect(response.headers[header], `${name}: ${header}`).toBeTruthy();
    expect(responses.map(([, r]) => r.statusCode)).toEqual([200, 200, 200, 200, 401, 404, 404]);
    await app.close(); await rm(dir, { recursive: true });
  });

  it('sets the values the story asks for', () => {
    const h = securityHeaders({ authDomain: 'kian-prod.firebaseapp.com' });
    expect(h['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Permissions-Policy']).toContain('microphone=(self)');
    expect(h['Permissions-Policy']).toContain('camera=()');
    expect(h['Permissions-Policy']).toContain('geolocation=()');
  });

  it('has a content security policy that lets the app work and nothing more', () => {
    const csp = contentSecurityPolicy({ authDomain: 'kian-prod.firebaseapp.com' });
    const directive = (name: string) => csp.split('; ').find(d => d.startsWith(`${name} `)) ?? '';
    expect(directive('default-src')).toBe("default-src 'none'");
    expect(directive('script-src')).toBe("script-src 'self'");
    expect(directive('style-src')).toBe("style-src 'self'");
    expect(directive('img-src')).toContain('blob:');
    expect(directive('media-src')).toContain('blob:');
    expect(directive('connect-src')).toContain("'self'");
    expect(directive('connect-src')).toContain('https://identitytoolkit.googleapis.com');
    expect(directive('connect-src')).toContain('https://securetoken.googleapis.com');
    expect(directive('frame-src')).toBe('frame-src https://kian-prod.firebaseapp.com');
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });

  it('frames nothing when the sign-in domain is unknown or odd, and never accepts a pasted policy fragment', () => {
    expect(contentSecurityPolicy({})).toContain("frame-src 'none'");
    expect(contentSecurityPolicy({ authDomain: "evil.com; script-src *" })).toContain("frame-src 'none'");
  });

  it('can be switched to report-only without a code change, and follows the Firebase project', () => {
    expect(securityHeaders({ mode: 'report-only' })['Content-Security-Policy-Report-Only']).toBeTruthy();
    expect(securityHeaders({ mode: 'report-only' })['Content-Security-Policy']).toBeUndefined();
    expect(securityHeaderOptionsFromEnv({ GOOGLE_CLOUD_PROJECT: 'kian-prod' } as NodeJS.ProcessEnv)).toEqual({ authDomain: 'kian-prod.firebaseapp.com', mode: 'enforce' });
    expect(securityHeaderOptionsFromEnv({ KIAN_CSP_MODE: 'report-only', KIAN_FIREBASE_AUTH_DOMAIN: 'x.firebaseapp.com' } as NodeJS.ProcessEnv)).toEqual({ authDomain: 'x.firebaseapp.com', mode: 'report-only' });
    expect(securityHeaderOptionsFromEnv({} as NodeJS.ProcessEnv).authDomain).toBeNull();
  });

  it('matches what the built app actually loads: no inline script, nothing from another site', async () => {
    const html = await readFile(new URL('../../web/dist/index.html', import.meta.url), 'utf8').catch(() => null);
    if (!html) return; // the web build is not present in every test run
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(html).not.toMatch(/\son[a-z]+=|style=|https?:\/\//);
  });
});
