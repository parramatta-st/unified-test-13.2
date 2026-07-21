import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { serialize } from 'cookie';
import { findTutor, hasTutorConfigSource } from '../../lib/tutorConfig';
import { SESSION_MAX_AGE_SECONDS, createSessionToken } from '../../lib/session';

// Constant-time password comparison. Hashing both sides first gives equal
// lengths, which timingSafeEqual requires, and avoids leaking length info.
function passwordsMatch(supplied: string, expected: string) {
  const a = crypto.createHash('sha256').update(String(supplied)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const { campus, tutor, password } = req.body || {};
  const expected = process.env.TUTOR_PASSWORD || '';

  if (!tutor || !password) {
    return res.status(400).json({ ok: false, error: 'Missing tutor or password' });
  }

  // Fail closed: with no password configured, older builds accepted ANY
  // password. That is never safe for a live centre.
  if (!expected) {
    return res.status(500).json({
      ok: false,
      error: 'Login is not configured yet. Set TUTOR_PASSWORD on the server before using the portal.',
    });
  }
  if (!passwordsMatch(String(password), expected)) {
    return res.status(401).json({ ok: false, error: 'Incorrect password' });
  }

  const tutorRecord = await findTutor(String(tutor || ''), String(campus || ''));
  if (tutorRecord && !tutorRecord.active) {
    return res.status(403).json({ ok: false, error: 'This tutor is inactive. Please contact admin.' });
  }

  // If a tutor config sheet is configured, require the tutor to exist in it.
  if (hasTutorConfigSource() && !tutorRecord) {
    return res.status(403).json({ ok: false, error: 'Tutor not found in active tutor list.' });
  }

  const isHttps = req.headers['x-forwarded-proto'] === 'https';
  const secure = isHttps || process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  const tutorName = (tutorRecord?.tutorName || String(tutor || '')).trim();
  const campusKey = (tutorRecord?.campusKey || String(campus || '')).trim();

  let sessionToken = '';
  try {
    sessionToken = await createSessionToken({ tutor: tutorName, campus: campusKey });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Could not create login session' });
  }

  const cookieOptions = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure, maxAge: SESSION_MAX_AGE_SECONDS };
  const cookies = [
    // The signed token is the ONLY cookie the server trusts for auth.
    serialize('st_sess', sessionToken, cookieOptions),
    // Display/debug helpers only — never used for authorisation decisions.
    serialize('st_tutor', tutorName, cookieOptions),
    serialize('st_campus', campusKey, cookieOptions),
    // Remove the legacy forgeable flag from any older sessions.
    serialize('st_auth', '', { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: 0 }),
  ];

  res.setHeader('Set-Cookie', cookies);
  return res.status(200).json({ ok: true, tutor: tutorName, campus: campusKey, role: tutorRecord?.role || 'tutor' });
}
