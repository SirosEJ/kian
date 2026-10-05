import { describe, expect, it, vi } from 'vitest';
import { needsAdminConsent, TeamsConnector, TeamsError, TEAMS_SCOPES } from './microsoft-teams.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Microsoft Teams connector', () => {
  it('builds a sign-in address with PKCE, the five delegated scopes and no secret', () => {
    const url = new URL(new TeamsConnector().authorizeUrl({ tenant: 'organizations', clientId: 'cid', redirectUri: 'https://kian.sepenta.io/', state: 'teams_abc', challenge: 'chal' }));
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe(TEAMS_SCOPES);
    expect(TEAMS_SCOPES.split(' ').sort()).toEqual(['ChatMessage.Send', 'Chat.Read', 'Chat.ReadWrite', 'User.Read', 'offline_access'].sort());
    expect(url.search).not.toMatch(/secret/i);
  });

  it('exchanges a code and refreshes a token with the verifier and the secret in the body only', async () => {
    const mock = vi.fn(async (_url: string, _init?: RequestInit) => json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }));
    const teams = new TeamsConnector(mock as unknown as typeof fetch);
    expect((await teams.exchangeCode({ tenant: 't', clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://x/', code: 'c', verifier: 'v' })).access_token).toBe('a');
    const body = String(mock.mock.calls[0][1]?.body);
    expect(body).toContain('code_verifier=v');
    expect(body).toContain('grant_type=authorization_code');
    expect(mock.mock.calls[0][0]).not.toContain('sec');
    await teams.refresh({ tenant: 't', clientId: 'cid', clientSecret: 'sec', refreshToken: 'r' });
    expect(String(mock.mock.calls[1][1]?.body)).toContain('grant_type=refresh_token');
  });

  it('keeps the Microsoft error so a missing administrator approval can be explained', async () => {
    const teams = new TeamsConnector((async () => json({ error: 'invalid_grant', error_description: 'AADSTS65001: The user or administrator has not consented' }, 400)) as typeof fetch);
    const result = await teams.exchangeCode({ tenant: 't', clientId: 'c', clientSecret: 's', redirectUri: 'r', code: 'c', verifier: 'v' });
    expect(result.access_token).toBeUndefined();
    expect(needsAdminConsent(result.error_description)).toBe(true);
    expect(needsAdminConsent('AADSTS70000: something else')).toBe(false);
    expect(needsAdminConsent(null)).toBe(false);
  });

  it('reads who is signed in, and names the reason when it cannot', async () => {
    const ok = new TeamsConnector((async () => json({ displayName: 'Peyman Ebrahimi', userPrincipalName: 'peyman@sepenta.io' })) as typeof fetch);
    expect(await ok.account({ accessToken: 't' })).toEqual({ name: 'Peyman Ebrahimi', account: 'peyman@sepenta.io' });
    for (const [status, code] of [[401, 'expired'], [403, 'forbidden'], [429, 'rate-limited'], [500, 'failed']] as const) {
      const failing = new TeamsConnector((async () => new Response('', { status })) as typeof fetch);
      await expect(failing.account({ accessToken: 't' }), String(status)).rejects.toMatchObject({ code });
      await expect(failing.account({ accessToken: 't' })).rejects.toBeInstanceOf(TeamsError);
    }
  });
});
