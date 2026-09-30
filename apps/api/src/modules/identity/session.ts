import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export type UserId = string;
export type VerifyToken = (token: string) => Promise<{ uid: string }>;

function unauthorized(): Error & { statusCode: number } {
  return Object.assign(new Error('Authentication required'), { statusCode: 401 });
}

export function createRequireUser(verify: VerifyToken) {
  return async (request: { headers: { authorization?: string } }): Promise<UserId> => {
    const match = /^Bearer (\S+)$/.exec(request.headers.authorization || '');
    if (!match) throw unauthorized();
    try {
      const decoded = await verify(match[1]);
      if (!decoded.uid) throw unauthorized();
      return decoded.uid;
    } catch {
      throw unauthorized();
    }
  };
}

export const requireUser = createRequireUser(async (token: string) => {
  if (!getApps().length) initializeApp();
  return getAuth().verifyIdToken(token, true);
});
