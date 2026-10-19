import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthStatus } from '../../lib/auth';
import { savePrintLog } from '../../lib/logs';

function normaliseRequestedPrintMode(body: any) {
  const source = body || {};
  const printOptions = source.print_options || {};
  const nestedOptions = source.options || {};
  const meta = source.meta || {};
  const rawValues = [source.printColorMode, source.print_color_mode, source.color_mode, printOptions.printColorMode, printOptions.print_color_mode, printOptions.color_mode, nestedOptions.printColorMode, nestedOptions.print_color_mode, nestedOptions.color_mode, meta.printColorMode, meta.print_color_mode, meta.color_mode].map((value) => String(value || '').trim().toLowerCase());
  const explicitMono = rawValues.some((value) => ['bw', 'b/w', 'b&w', 'blackwhite', 'black_white', 'black-white', 'black/white', 'black-and-white', 'black and white', 'black & white', 'monochrome', 'mono', 'grayscale', 'greyscale', 'gray', 'grey'].includes(value));
  const explicitColour = rawValues.some((value) => ['colour', 'color', 'fullcolor', 'full_colour', 'full-color', 'full colour'].includes(value));
  const flagMono = Boolean(source.black_white || source.blackWhite || source.grayscale || source.greyscale || source.monochrome || printOptions.black_white || printOptions.blackWhite || printOptions.grayscale || printOptions.greyscale || printOptions.monochrome || nestedOptions.grayscale || nestedOptions.greyscale || nestedOptions.monochrome || meta.black_white || meta.blackWhite || meta.grayscale || meta.greyscale || meta.monochrome || printOptions.color === false || printOptions.colour === false || nestedOptions.color === false || nestedOptions.colour === false || source.color === false || source.colour === false || meta.color === false || meta.colour === false);
  if (explicitMono || (!explicitColour && flagMono)) return 'monochrome';
  return 'color';
}

function normalizePrintPayload(action: string, body: any) {
  if (action !== 'print') return body || {};
  const source = body || {};
  const printOptions = source.print_options || {};
  const nestedOptions = source.options || {};
  const meta = source.meta || {};
  const cupsMode = normaliseRequestedPrintMode(source);
  const monochrome = cupsMode === 'monochrome';
  return { ...source, printColorMode: monochrome ? 'bw' : 'colour', print_color_mode: cupsMode, color_mode: cupsMode, black_white: monochrome, blackWhite: monochrome, grayscale: monochrome, greyscale: monochrome, monochrome, color: !monochrome, colour: !monochrome, print_options: { ...printOptions, printColorMode: monochrome ? 'bw' : 'colour', print_color_mode: cupsMode, color_mode: cupsMode, black_white: monochrome, blackWhite: monochrome, grayscale: monochrome, greyscale: monochrome, monochrome, color: !monochrome, colour: !monochrome }, options: { ...nestedOptions, color: !monochrome, colour: !monochrome, grayscale: monochrome, greyscale: monochrome, monochrome, color_mode: cupsMode }, meta: { ...meta, printColorMode: monochrome ? 'bw' : 'colour', print_color_mode: cupsMode, color_mode: cupsMode, black_white: monochrome } };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await getAuthStatus(req);
  if (!auth.authed) return res.status(401).json({ ok: false, error: 'Login required' });
  const base = (process.env.PRINT_API_URL || '').trim().replace(/\/+$/, '');
  const token = (process.env.PRINT_API_TOKEN || '').trim();
  if (!base || !token) return res.status(500).json({ ok: false, error: 'Print API not configured' });
  const action = (req.query.action as string) || 'health';
  if ((action === 'print' || action === 'print-topic') && req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST to print.' });
  if (action === 'print' && req.body?.portalLog && (!String(req.body?.meta?.student || '').trim() || !Number.isFinite(Number(req.body.material_id)))) return res.status(400).json({ ok: false, error: 'Choose a student and worksheet before printing.' });
  const url = action === 'health' ? `${base}/api/health` : action === 'catalog' ? `${base}/api/catalog` : action === 'print' ? `${base}/api/print` : action === 'print-topic' ? `${base}/api/print-topic` : action === 'stamp-settings' ? `${base}/api/pdf-stamp-settings` : `${base}/healthz`;
  const timeout = parseInt(process.env.PRINT_PROXY_TIMEOUT_MS || '15000', 10);
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), timeout);
  try {
    const { portalLog, ...printBody } = req.body || {};
    const payload = req.method === 'POST' ? normalizePrintPayload(action, printBody) : undefined;
    if (action === 'print' && payload) payload.meta = { ...payload.meta, tutor: auth.tutor };
    const cupsMode = payload && action === 'print' ? normaliseRequestedPrintMode(payload) : 'color';
    const monochrome = cupsMode === 'monochrome';
    const init:any = { method: req.method, headers: { 'X-PRINT-TOKEN': token }, signal: controller.signal };
    if (action === 'print') { init.headers['X-PRINT-COLOR-MODE'] = cupsMode; init.headers['X-PRINT-MONOCHROME'] = monochrome ? '1' : '0'; init.headers['X-PRINT-GRAYSCALE'] = monochrome ? '1' : '0'; }
    if (req.method === 'POST') { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(payload || {}); }
    const r = await fetch(url, init);
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const j = await r.json();
      clearTimeout(t);
      if (action === 'print' && portalLog && typeof portalLog === 'object') {
        try {
          await savePrintLog({ ...portalLog, when: new Date().toISOString(), kind: 'print',
            student: String(payload.meta.student).trim(), tutor: auth.tutor, campusKey: auth.campus,
            qty: payload.qty, material_id: payload.material_id, material_ids: [payload.material_id],
            sourceForm: portalLog.sourceForm === 'rolling-print-queue' ? 'rolling-print-queue' : 'manual-print',
            ok: r.ok && j?.ok === true, error: r.ok && j?.ok === true ? '' : j?.error || 'Print service did not confirm acceptance.' });
        } catch {
          if (r.ok && j?.ok === true) j.logWarning = 'The print service accepted this file, but its history record is unavailable. Do not resend it to repair history.';
        }
      }
      return res.status(r.status).json(j);
    }
    const raw = await r.text(); return res.status(r.status).json({ raw });
  } catch (e:any) { return res.status(502).json({ ok:false, error: e?.message || 'Bad gateway' }); }
  finally { clearTimeout(t); }
}
