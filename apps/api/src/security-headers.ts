import type { FastifyInstance } from 'fastify';

/**
 * Browser security headers for every response (API, web files and the HTML page).
 * The content security policy lists exactly what the app uses: its own scripts, styles, fonts and API, the Firebase
 * email sign-in servers, images from itself and blob: (the photos), and media from blob: (dictation). Nothing is inline.
 */
export type SecurityHeaderOptions = {
  /** `<firebase project>.firebaseapp.com`: the Firebase sign-in helper page may be framed from here. */
  authDomain?: string | null;
  /** `report-only` shows what the policy would block without blocking it (KIAN_CSP_MODE=report-only), the quick way to loosen a rule in an emergency. */
  mode?: 'enforce' | 'report-only';
};

const FIREBASE_SIGN_IN = ['https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com'];

export function contentSecurityPolicy(options: SecurityHeaderOptions = {}): string {
  const frames = options.authDomain && /^[a-z0-9.-]+$/i.test(options.authDomain) ? [`https://${options.authDomain}`] : ["'none'"];
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    `connect-src 'self' ${FIREBASE_SIGN_IN.join(' ')}`,
    `frame-src ${frames.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
  ].join('; ');
}

export function securityHeaders(options: SecurityHeaderOptions = {}): Record<string, string> {
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), interest-cohort=()',
    [options.mode === 'report-only' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy']: contentSecurityPolicy(options),
  };
}

/** Adds the headers to every response, errors and static files included. Existing headers set by a route are left alone. */
export function registerSecurityHeaders(app: FastifyInstance, options: SecurityHeaderOptions = {}) {
  const headers = securityHeaders(options);
  app.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(headers)) if (!reply.hasHeader(name)) reply.header(name, value);
    return payload;
  });
}

/** Reads the deployment settings: the Firebase project (the sign-in domain follows from it) and the optional report-only switch. */
export function securityHeaderOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): SecurityHeaderOptions {
  const project = env.GOOGLE_CLOUD_PROJECT;
  return {
    authDomain: env.KIAN_FIREBASE_AUTH_DOMAIN || (project ? `${project}.firebaseapp.com` : null),
    mode: env.KIAN_CSP_MODE === 'report-only' ? 'report-only' : 'enforce',
  };
}
