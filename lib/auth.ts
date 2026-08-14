import { parse } from 'cookie';
import type { NextApiRequest } from 'next';
import { SESSION_COOKIE, verifySessionToken } from './session';
import type { SessionRole } from './session';

export type AuthStatus = {
  authed: boolean;
  tutor: string;
  campus: string;
  role: SessionRole | '';
};

/**
 * Resolves the logged-in tutor from the signed session cookie.
 *
 * SECURITY: tutor, campus, and role are read from the verified token payload,
 * never from the loose st_tutor / st_campus / localStorage values (those are
 * display-only and can be set by the client).
 */
export async function getAuthStatus(req: NextApiRequest): Promise<AuthStatus> {
  const cookies = parse(req.headers.cookie || '');
  const session = await verifySessionToken(cookies[SESSION_COOKIE]);
  if (!session) return { authed: false, tutor: '', campus: '', role: '' };
  return {
    authed: true,
    tutor: session.tutor,
    campus: session.campus,
    role: session.role || '',
  };
}
