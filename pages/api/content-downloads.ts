import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthStatus } from '../../lib/auth';
import { selectContentDownloads } from '../../lib/contentDownloads';
import { readSheetRows } from '../../lib/googleSheets';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({error:'Method not allowed'}); }
  const auth = await getAuthStatus(req);
  if (!auth.authed) return res.status(401).json({error:'Login required'});
  const campus = String(auth.campus || '').trim().toLowerCase();
  if (!campus) return res.status(403).json({error:'Campus required'});
  const sheet = process.env.CONTENT_DOWNLOADS_SPREADSHEET_ID || '1nhTMNdTnrV5rKsauZMkwDV0D50AlrY7VvXY_1HZtius';
  if (!sheet) return res.status(503).json({error:'Content downloads are not configured'});
  try {
    const rows = await readSheetRows('content_downloads', sheet);
    const downloads = selectContentDownloads(rows, campus);
    return res.status(200).json({downloads});
  } catch (error) {
    if (/Unable to parse range.*content_downloads/i.test(error instanceof Error ? error.message : '')) return res.status(200).json({downloads:[]});
    return res.status(502).json({error:'Could not load content downloads. Check the archive sheet connection.'}); }
}
