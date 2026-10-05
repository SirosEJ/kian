export type TeamsConnection = { accessToken: string };
export type TeamsAccount = { name: string; account: string };
export const TEAMS_SCOPES = 'User.Read offline_access Chat.Read Chat.ReadWrite ChatMessage.Send';
export const GRAPH = 'https://graph.microsoft.com/v1.0';
const MICROSOFT_LOGIN = 'https://login.microsoftonline.com';
export type TeamsFailure = 'expired' | 'forbidden' | 'rate-limited' | 'failed';
export class TeamsError extends Error { constructor(readonly code: TeamsFailure, message: string) { super(message); } }

/** What Microsoft says when an administrator has to approve Kian first (AADSTS65001, AADSTS90094, AADSTS650057 and similar). */
export function needsAdminConsent(description: string | null | undefined): boolean {
  return /AADSTS(?:65001|90094|90008|650057|700016)|admin(?:istrator)?\s+(?:consent|approval)|need admin approval/i.test(description ?? '');
}

/** Microsoft Teams through Microsoft Graph, always with the signed-in user's own delegated token. */
export class TeamsConnector {
  constructor(private readonly request: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) })) {}

  authorizeUrl(input: { tenant: string; clientId: string; redirectUri: string; state: string; challenge: string }): string {
    const url = new URL(`${MICROSOFT_LOGIN}/${encodeURIComponent(input.tenant)}/oauth2/v2.0/authorize`);
    url.search = new URLSearchParams({ client_id: input.clientId, response_type: 'code', redirect_uri: input.redirectUri, response_mode: 'query', scope: TEAMS_SCOPES, state: input.state, code_challenge: input.challenge, code_challenge_method: 'S256', prompt: 'select_account' }).toString();
    return url.toString();
  }

  private async token(tenant: string, body: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }> {
    const response = await this.request(`${MICROSOFT_LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
    const json = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!response.ok && !json.error) json.error = `http_${response.status}`;
    return json;
  }
  exchangeCode(input: { tenant: string; clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string }) {
    return this.token(input.tenant, { client_id: input.clientId, client_secret: input.clientSecret, grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri, code_verifier: input.verifier, scope: TEAMS_SCOPES });
  }
  refresh(input: { tenant: string; clientId: string; clientSecret: string; refreshToken: string }) {
    return this.token(input.tenant, { client_id: input.clientId, client_secret: input.clientSecret, grant_type: 'refresh_token', refresh_token: input.refreshToken, scope: TEAMS_SCOPES });
  }

  /** Who is signed in. Doubles as the connection test: a bad or expired token fails here with a plain reason. */
  async account(connection: TeamsConnection): Promise<TeamsAccount> {
    const response = await this.request(`${GRAPH}/me?$select=displayName,userPrincipalName,mail`, { headers: { Authorization: `Bearer ${connection.accessToken}`, Accept: 'application/json' } });
    if (response.status === 401) throw new TeamsError('expired', 'Microsoft access expired');
    if (response.status === 403) throw new TeamsError('forbidden', 'Microsoft refused access');
    if (response.status === 429) throw new TeamsError('rate-limited', 'Microsoft is busy');
    if (!response.ok) throw new TeamsError('failed', `Microsoft returned ${response.status}`);
    const me = await response.json() as { displayName?: string; userPrincipalName?: string; mail?: string };
    const account = me.mail || me.userPrincipalName || '';
    return { name: (me.displayName || account || 'Microsoft account').slice(0, 120), account: account.slice(0, 200) };
  }
}
