import type { NextApiRequest } from 'next';
import { getAuthStatus } from './auth';
import { isAdminTutor } from './tutorConfig';

export async function getTutorFromRequest(req: NextApiRequest) {
  const auth = await getAuthStatus(req);
  return auth.tutor;
}

export async function getCampusFromRequest(req: NextApiRequest) {
  const auth = await getAuthStatus(req);
  return auth.campus;
}

/**
 * Admin access = valid signed session AND that tutor holds the admin role in
 * the tutor config. The tutor identity comes from the verified session token,
 * so a client cannot claim to be an admin by editing cookies.
 */
export async function requireAdmin(req: NextApiRequest) {
  const auth = await getAuthStatus(req);
  const isAdmin = auth.authed && (await isAdminTutor(auth.tutor, auth.campus));
  return { authed: auth.authed, tutor: auth.tutor, campus: auth.campus, isAdmin };
}
