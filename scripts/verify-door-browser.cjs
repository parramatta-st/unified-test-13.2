/* Run against an isolated local Next build. Never point this suite at production.
 * npm install --prefix /tmp/door-browser --no-save @playwright/test@1.57.0
 * NODE_PATH=/tmp/door-browser/node_modules node scripts/verify-door-browser.cjs
 * The real page and middleware run; all attendance data is synthetic and API-mocked.
 */
const { chromium, firefox, webkit, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const base = 'http://127.0.0.1:3217';
const output = path.resolve('artifacts/door-clock');
fs.mkdirSync(output, { recursive: true });
const log = fs.openSync(path.join(output, 'server.log'), 'w');
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3217'], {
  stdio: ['ignore', log, log], env: { ...process.env, SESSION_SECRET: 'isolated-door-browser-session', TUTOR_PASSWORD: 'isolated-not-a-live-password', GOOGLE_SERVICE_ACCOUNT_JSON: '', GOOGLE_PRIVATE_KEY: '', GOOGLE_SHEETS_SPREADSHEET_ID: '' },
});
const key = 'a'.repeat(43); // Synthetic test key; never configured on any live centre.
const campus = 'parramatta';
const roster = [
  { id: 'moli', name: 'Moli Example' }, { id: 'alex', name: 'Alex Example' },
  { id: 'sam', name: 'Sam Example' }, { id: 'jo', name: 'Jo Example' },
  { id: 'lee', name: 'Lee Example' }, { id: 'kim', name: 'Kim Example' },
  { id: 'long', name: 'Alexandriaverylongfirstname Demonstration Longsurname' },
];
const choice = JSON.stringify({ campus, tutorId: 'moli' });
const results = [];
let browserName = '';
async function check(name, fn) {
  try { await fn(); results.push({ browser: browserName, name, passed: true }); console.log(`PASS ${browserName}: ${name}`); }
  catch (error) { results.push({ browser: browserName, name, passed: false, error: error.stack }); console.error(`FAIL ${browserName}: ${name}\n${error.stack}`); }
}
async function scenario(browser, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(({ remembered, denyStorage }) => {
    window.__gpsCalls = 0;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition() { window.__gpsCalls++; throw Error('Door clock must not request GPS'); }, watchPosition() { window.__gpsCalls++; throw Error('No background GPS'); } } });
    if (denyStorage) {
      for (const storage of ['localStorage', 'sessionStorage']) Object.defineProperty(window, storage, { get() { throw new DOMException('Blocked', 'SecurityError'); } });
    } else if (remembered) localStorage.setItem('st_door_choice_v1', remembered);
  }, { remembered: options.remembered, denyStorage: options.denyStorage });
  const state = { active: options.active ? { shiftId: 'shift-demo', clockIn: new Date(Date.now() - 7200000).toISOString(), version: 1, needsReview: false } : null, roster: [...roster], posts: [], getCount: 0, failGet: false, failPostOnce: false, stalePost: false, revoked: false, adminEnabled: false, delayGet: 0, delayPost: 0, urlEvents: [], receipts: new Map() };
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => state.urlEvents.push(r.url()));
  await context.route('**/api/**', async route => {
    const request = route.request(); const pathname = new URL(request.url()).pathname;
    const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname === '/api/door-clock') {
      assert.equal(request.headers()['x-st-door-key'], key);
      assert.equal(request.headers().cookie, undefined, 'door request must omit portal cookies');
      if (state.revoked) return send({ ok: false, error: 'This door link is no longer active.' }, 401);
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); state.posts.push(body);
        if (state.delayPost) await new Promise(r => setTimeout(r, state.delayPost));
        if (state.stalePost) { state.stalePost = false; state.active = { shiftId: 'shift-new', clockIn: new Date().toISOString(), version: 1, needsReview: false }; return send({ ok: false, code: 'STALE_SHIFT', error: 'Your shift has changed. Refresh to see the correct action.' }, 409); }
        let receipt = state.receipts.get(body.requestId);
        if (!receipt) { receipt = { ok: true, action: body.action, tutorName: state.roster.find(t => t.id === body.tutorId).name, timestamp: new Date().toISOString() }; state.receipts.set(body.requestId, receipt); state.active = body.action === 'clock_in' ? { shiftId: 'shift-demo', clockIn: receipt.timestamp, version: 1, needsReview: false } : null; }
        if (state.failPostOnce) { state.failPostOnce = false; return send({ ok: false, error: 'Not confirmed yet. Please check the result.' }, 503); }
        return send(receipt);
      }
      state.getCount++;
      if (state.delayGet) await new Promise(r => setTimeout(r, state.delayGet));
      if (state.failGet) return send({ ok: false, error: 'Unable to check current shift.' }, 503);
      const requested = new URL(request.url()).searchParams.get('tutorId');
      const selectedId = state.roster.some(t => t.id === requested) ? requested : '';
      return send({ ok: true, campus, campusName: 'Success Tutoring Parramatta', linkId: 'door-example', tutors: state.roster, selectedId, activeShift: selectedId ? state.active : null, serverTime: new Date().toISOString() });
    }
    if (pathname === '/api/admin-status') return send({ ok: true, authed: !!options.admin, isAdmin: !!options.admin, campus, tutor: 'Demo Admin' });
    if (pathname === '/api/admin-door-clock') {
      if (request.method() === 'POST') { state.adminEnabled = true; return send({ ok: true, enabled: true, path: `/clock/tap#key=${key}` }); }
      return send({ ok: true, enabled: state.adminEnabled, campus, updatedAt: '', updatedBy: '' });
    }
    if (pathname === '/api/tutors') return send({ ok: true, tutors: roster.map(t => ({ tutorName: t.name, campusKey: campus, campusName: 'Parramatta' })), campuses: [{ id: campus, name: 'Parramatta' }] });
    if (pathname === '/api/time-clock') return send({ ok: true, tutor: 'Demo Admin', campus, activeShift: null, isAdmin: true, tutors: [], config: { sheets: false, geofence: false } });
    if (pathname === '/api/inbox-unread') return send({ ok: true, unreadTotal: 0 });
    throw new Error(`Unexpected API call ${pathname}`);
  });
  async function open(withKey = true) { await page.goto(`${base}/clock/tap${withKey ? `#key=${key}` : ''}`); }
  async function choose() { await page.getByRole('button', { name: /Moli Example/ }).click(); await expect(page.getByRole('button', { name: 'Clock In', exact: true })).toBeEnabled(); }
  async function snapshot(name) { await page.screenshot({ path: path.join(output, `${browserName}-${name}.png`), fullPage: true }); }
  async function finish() { assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => window.__gpsCalls), 0); await context.close(); }
  return { context, page, state, open, choose, snapshot, finish };
}
function adminCookie() {
  const payload = Buffer.from(JSON.stringify({ tutor: 'Demo Admin', campus, role: 'admin', exp: Date.now() + 300000 })).toString('base64url');
  const unsigned = `v1.${payload}`;
  return `${unsigned}.${crypto.createHmac('sha256', 'st-portal-session:isolated-door-browser-session').update(unsigned).digest('base64url')}`;
}
(async () => {
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/healthz')).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 200)); }
    assert.ok(ready, 'Next test server did not start');
    for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
      browserName = name; const browser = await engine.launch({ headless: true });
      await check('first selection, single POST, no GPS/session, confirmation then real login redirect', async () => {
        const s = await scenario(browser); await s.open(); await expect(s.page.getByRole('heading', { name: "Who's here?" })).toBeVisible(); assert.equal(s.state.posts.length, 0);
        await s.snapshot('pick-name'); await s.choose(); await s.snapshot('clock-in');
        assert.equal(await s.page.evaluate(() => location.hash), '');
        assert.ok(s.state.urlEvents.every(url => !url.includes(key)), 'access key leaked into a request URL');
        s.state.delayPost = 200;
        await s.page.getByRole('button', { name: 'Clock In', exact: true }).evaluate(el => { el.click(); el.click(); });
        await expect(s.page.getByRole('heading', { name: "You're clocked in." })).toBeVisible(); await s.snapshot('success');
        await s.page.waitForURL('**/login', { timeout: 8000 });
        assert.equal(s.state.posts.length, 1); assert.equal((await s.context.cookies()).length, 0);
        const remembered = await s.page.evaluate(() => JSON.parse(localStorage.getItem('st_door_choice_v1'))); assert.equal(remembered.tutorId, 'moli'); await s.open(); await expect(s.page.getByRole('heading', { name: 'Hi Moli.' })).toBeVisible(); await expect(s.page.getByRole('button', { name: 'Clock Out', exact: true })).toBeEnabled(); await s.snapshot('remembered-clock-out'); await s.finish();
      });
      await check('remembered name, Clock Out, change name and re-tap without reloading', async () => {
        const s = await scenario(browser, { remembered: choice, active: true }); await s.open();
        await expect(s.page.getByRole('heading', { name: 'Hi Moli.' })).toBeVisible();
        await s.page.getByRole('button', { name: 'Clock Out', exact: true }).click(); await expect(s.page.getByRole('heading', { name: "You're clocked out." })).toBeVisible();
        await s.snapshot('clock-out-success');
        await s.page.evaluate(k => { location.hash = `key=${k}`; }, key);
        await expect(s.page.getByRole('button', { name: 'Clock In', exact: true })).toBeEnabled();
        await s.page.getByRole('button', { name: /Change tutor/ }).click(); await expect(s.page.getByRole('heading', { name: "Who's here?" })).toBeVisible(); await s.finish();
      });
      await check('ambiguous send failure + reload preserves the exact retry ID', async () => {
        const s = await scenario(browser, { remembered: choice }); await s.open();
        s.state.failPostOnce = true; await s.page.getByRole('button', { name: 'Clock In', exact: true }).click();
        await expect(s.page.getByRole('button', { name: 'Check clock-in result' })).toBeEnabled();
        await s.page.reload(); await expect(s.page.getByRole('button', { name: 'Check clock-in result' })).toBeEnabled();
        await s.page.getByRole('button', { name: 'Check clock-in result' }).click(); await expect(s.page.getByRole('heading', { name: "You're clocked in." })).toBeVisible();
        assert.equal(s.state.posts.length, 2); assert.equal(s.state.posts[0].requestId, s.state.posts[1].requestId); assert.equal(s.state.receipts.size, 1); await s.finish();
      });
      await check('storage-blocked phones can still select and clock in', async () => {
        const s = await scenario(browser, { denyStorage: true }); await s.open(); await s.choose();
        await s.page.getByRole('button', { name: 'Clock In', exact: true }).click(); await expect(s.page.getByRole('heading', { name: "You're clocked in." })).toBeVisible(); await s.finish();
      });
      await check('stale action never silently toggles to the opposite action', async () => {
        const s = await scenario(browser, { remembered: choice }); await s.open(); s.state.stalePost = true;
        await s.page.getByRole('button', { name: 'Clock In', exact: true }).click(); await expect(s.page.getByRole('main').getByRole('alert')).toContainText('shift has changed');
        assert.ok(s.page.url().includes('/clock/tap')); await s.page.getByRole('button', { name: 'Refresh shift' }).click();
        await expect(s.page.getByRole('button', { name: 'Clock Out', exact: true })).toBeEnabled(); assert.equal(s.state.posts.length, 1); await s.finish();
      });
      await check('failed status reads disable the action until a successful refresh', async () => {
        const s = await scenario(browser, { remembered: choice }); await s.open(); await expect(s.page.getByRole('button', { name: 'Clock In', exact: true })).toBeEnabled();
        s.state.failGet = true; await s.page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(s.page.getByRole('main').getByRole('alert')).toBeVisible(); await expect(s.page.getByRole('button', { name: 'Clock In', exact: true })).toBeDisabled();
        s.state.failGet = false; await s.page.getByRole('button', { name: 'Refresh shift' }).click(); await expect(s.page.getByRole('button', { name: 'Clock In', exact: true })).toBeEnabled(); await s.finish();
      });
      await check('missing/revoked keys fail closed with no clock POST', async () => {
        const s = await scenario(browser); await s.open(false); await expect(s.page.getByRole('heading', { name: 'Start at the door.' })).toBeVisible();
        assert.equal(s.state.getCount, 0); s.state.revoked = true; await s.open(); await expect(s.page.getByRole('heading', { name: 'Start at the door.' })).toBeVisible(); assert.equal(s.state.posts.length, 0); await s.finish();
      });
      await check('removed remembered tutor returns to name selection', async () => {
        const s = await scenario(browser, { remembered: choice }); s.state.roster = roster.filter(t => t.id !== 'moli'); await s.open(); await expect(s.page.getByRole('heading', { name: "Who's here?" })).toBeVisible(); assert.equal(s.state.posts.length, 0); await s.finish();
      });
      await check('small screen, large text and long names do not overflow', async () => {
        const s = await scenario(browser, { viewport: { width: 320, height: 568 } }); await s.open(); await s.page.getByRole('button', { name: /Alexandriaverylongfirstname/ }).click();
        await expect(s.page.getByRole('button', { name: 'Clock In', exact: true })).toBeEnabled();
        assert.ok(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await s.snapshot('320-long-name');
        await s.page.addStyleTag({ content: 'html { font-size: 24px !important; }' }); assert.ok(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await s.finish();
      });
      await check('empty roster and no matching search stay usable', async () => {
        const s = await scenario(browser); await s.open(); await s.page.getByRole('textbox', { name: 'Search tutors' }).fill('No match'); await expect(s.page.getByText('No matching names. Try another search.')).toBeVisible();
        s.state.roster = []; await s.page.reload(); await expect(s.page.getByText('No active tutors are available. Please contact your centre manager.')).toBeVisible(); await s.finish();
      });
      await check('changing tutor during a slow refresh does not trap loading', async () => {
        const s = await scenario(browser, { remembered: choice }); await s.open(); await expect(s.page.getByRole('button', { name: 'Clock In', exact: true })).toBeEnabled();
        s.state.delayGet = 400; await s.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await s.page.getByRole('button', { name: /Change tutor/ }).click();
        await expect(s.page.getByRole('heading', { name: "Who's here?" })).toBeVisible(); await s.choose(); await s.finish();
      });
      await check('admin creation renders local QR and no external QR request', async () => {
        const s = await scenario(browser, { admin: true, viewport: { width: 1280, height: 900 } });
        await s.context.addCookies([{ name: 'st_sess', value: adminCookie(), url: base, httpOnly: true, sameSite: 'Lax' }]);
        await s.page.goto(base + '/admin/door-clock'); await s.page.getByRole('button', { name: 'Create door link', exact: true }).click();
        await expect(s.page.getByRole('textbox', { name: 'Door link (shown only when created)' })).toHaveValue(`${base}/clock/tap#key=${key}`);
        await expect(s.page.getByRole('img', { name: 'Scan to open the door Time Clock' })).toBeVisible();
        const qrSrc = await s.page.getByRole('img', { name: 'Scan to open the door Time Clock' }).getAttribute('src'); assert.ok(qrSrc.startsWith('data:image/svg+xml'));
        await expect(s.page.getByText('Door link enabled', { exact: true })).toBeVisible();
        await expect(s.page.getByRole('button', { name: 'Replace door link', exact: true })).toBeEnabled();
        await s.snapshot('admin-setup');
        await s.page.setViewportSize({ width: 390, height: 844 }); assert.ok(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await s.snapshot('admin-mobile'); await s.finish();
      });
      await browser.close();
    }
    browserName = 'http';
    await check('middleware only exposes exact door page; normal pages and APIs remain protected', async () => {
      for (const route of ['/feedback', '/admin', '/admin/door-clock', '/clock/tap/extra']) {
        const response = await fetch(base + route, { redirect: 'manual' }); assert.ok([307,308].includes(response.status), `${route} not protected`); assert.ok(response.headers.get('location').includes('/login'));
      }
      const page = await fetch(base + '/clock/tap'); assert.equal(page.status, 200); assert.ok(page.headers.get('permissions-policy').includes('geolocation=()')); assert.ok(page.headers.get('cache-control').includes('no-store'));
      assert.equal((await fetch(base + '/api/door-clock')).status, 401);
      assert.equal((await fetch(base + '/api/admin-door-clock')).status, 401);
    });
  } catch (error) { results.push({ browser: browserName, name: 'suite setup', passed: false, error: error.stack }); console.error(error); }
  finally {
    server.kill(); fs.closeSync(log);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    const failed = results.filter(r => !r.passed); console.log(`Browser journeys: ${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exitCode = 1;
  }
})();
