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
 * Admin access = valid signed session AND an admin role that was securely
 * resolved at login time.
 *
 * New sessions carry the tutor role inside the HMAC-signed token, so a
 * temporary Google Sheets read failure cannot demote an already-authenticated
 * admin mid-session. Older sessions (created before role-bearing tokens) fall
 * back to the live tutor config until the tutor next logs in.
 */
export async function requireAdmin(req: NextApiRequest) {
  const auth = await getAuthStatus(req);
  if (!auth.authed) {
    return { authed: false, tutor: '', campus: '', isAdmin: false };
  }

  let isAdmin = false;
  if (auth.role === 'admin') {
    isAdmin = true;
  } else if (auth.role === 'tutor') {
    isAdmin = false;
  } else {
    // Backward compatibility for existing signed sessions that pre-date the
    // role claim. The next successful login upgrades the session automatically.
    isAdmin = await isAdminTutor(auth.tutor, auth.campus);
  }

  return { authed: true, tutor: auth.tutor, campus: auth.campus, isAdmin };
}
