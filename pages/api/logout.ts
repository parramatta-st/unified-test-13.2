import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  const expire = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure, maxAge: 0 };
  const cookies = [
    serialize('st_sess', '', expire),
    serialize('st_auth', '', expire),
    serialize('st_tutor', '', expire),
    serialize('st_campus', '', expire),
  ];
  res.setHeader('Set-Cookie', cookies);

  if (req.method === 'GET') return res.redirect('/login');
  return res.status(200).json({ ok: true });
}
