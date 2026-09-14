import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import type { TestContext } from 'node:test';

export function fixtureSheets(t: TestContext) {
  const previous = { ...process.env };
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.SESSION_SECRET = 'isolated-time-clock-entry-test';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'fixture@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'fixture-only-spreadsheet';
  process.env.TIME_CLOCK_SPREADSHEET_ID = 'fixture-only-spreadsheet';
  process.env.TUTOR_CONFIG_JSON = JSON.stringify(['Demo Tutor', 'Second Tutor', 'Demo Admin'].map(tutorName => ({campusKey: 'test-campus', tutorName, role: tutorName === 'Demo Admin' ? 'admin' : 'tutor', active: true})));
  process.env.TIME_CLOCK_LATITUDE = '0';
  process.env.TIME_CLOCK_LONGITUDE = '0';
  process.env.TIME_CLOCK_RADIUS_METRES = '150';
  process.env.TIME_CLOCK_MAX_ACCURACY_METRES = '350';
  let failReads = false;
  const sheets = new Map<string, unknown[][]>([['unrelated', [['keep'], ['untouched']]]]);
  const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  // Intercept every outbound call. No real Google credentials or spreadsheet are used.
  t.mock.method(globalThis, 'fetch', async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'oauth2.googleapis.com') return reply({ access_token: 'fixture-token', expires_in: 3600 });
    assert.equal(url.hostname, 'sheets.googleapis.com');
    assert.ok(url.pathname.includes('fixture-only-spreadsheet'));
    const path = decodeURIComponent(url.pathname);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (path.endsWith(':batchUpdate')) {
      for (const request of body.requests) sheets.set(request.addSheet.properties.title, []);
      return reply({});
    }
    if (!path.includes('/values/')) return reply({ sheets: [...sheets.keys()].map((title) => ({ properties: { title } })) });
    const range = path.split('/values/')[1];
    const name = range.split('!')[0].replace(/^'|'$/g, '');
    if (method === 'GET' && failReads) throw new Error('Fixture network unavailable');
    if (method === 'GET') return reply({ values: sheets.get(name) || [] });
    if (path.endsWith(':append')) {
      sheets.set(name, [...(sheets.get(name) || []), ...body.values]);
    } else if (method === 'PUT') {
      assert.equal(url.searchParams.get('valueInputOption'), 'RAW');
      sheets.set(name, body.values);
    } else {
      assert.fail(`Unexpected test Sheets request: ${method} ${path}`);
    }
    return reply({});
  });

  return { sheets, failReads(value: boolean) { failReads = value; }, restore() {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }};
}
