import assert from 'node:assert/strict';
import test from 'node:test';
import nodemailer from 'nodemailer';
import { createSessionToken, SESSION_COOKIE, verifySessionToken } from '../lib/session';
import { upsertSheetRowByKey } from '../lib/googleSheets';
import { fixtureSheets } from './helpers/timeClockSheets';

test('portal data and write APIs reject signed-out requests before accessing external services', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unauthenticated request reached an upstream service'); });
  const routes = ['contacts', 'curriculum', 'student-progress', 'student-print-history', 'check-duplicate-print',
    'check-duplicate-feedback', 'admin-dashboard', 'admin-sheets-status', 'admin-members', 'admin-tutors',
    'inbox-unread', 'inbox-read', 'inbox-reply', 'sent-feedback', 'log-print', 'send-feedback', 'print-proxy', 'print-settings'];
  for (const route of routes) {
    const handler = (await import(`../pages/api/${route}`)).default;
    for (const method of ['GET', 'POST']) {
      let status = 200;
      const res = {setHeader() {}, status(value: number) {status = value; return res;}, json() {return res;}, end() {return res;}};
      await handler({method, query: {}, body: {}, headers: {}} as any, res as any);
      assert.ok([401, 403, 405].includes(status), `${method} ${route}: ${status}`);
    }
  }
  assert.equal((globalThis.fetch as any).mock.callCount(), 0);
});

test('signed sessions reject altered roles and expired tokens', async () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'isolated-release-session-test';
  try {
    const token = await createSessionToken({tutor: 'Demo Tutor', campus: 'test-campus', role: 'tutor'});
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    payload.role = 'admin';
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
    assert.equal(await verifySessionToken(parts.join('.')), null);
    assert.equal(await verifySessionToken(await createSessionToken({tutor: 'Demo Tutor', campus: 'test-campus'}, -1)), null);
    assert.equal(SESSION_COOKIE, 'st_sess');
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test('member upserts stop on a failed read without replacing existing data', async (t) => {
  const fixture = fixtureSheets(t);
  try {
    fixture.sheets.set('members', [['id', 'name'], ['1', 'Demo Student']]);
    fixture.failReads(true);
    await assert.rejects(upsertSheetRowByKey({sheetName: 'members', headers: ['id', 'name'], keyHeader: 'id', keyValue: '2', row: {id: '2', name: 'Other Student'}}), /network unavailable/);
    assert.deepEqual(fixture.sheets.get('members'), [['id', 'name'], ['1', 'Demo Student']]);
  } finally { fixture.restore(); }
});

test('updated mail package composes feedback safely without sending email', async () => {
  const transport = nodemailer.createTransport({streamTransport: true, buffer: true, newline: 'unix'});
  const result = await transport.sendMail({from: 'Portal <sender@example.invalid>', to: 'parent@example.invalid',
    subject: 'Lesson feedback', text: 'Demo feedback', html: '<p>Demo feedback</p>'});
  const message = result.message.toString();
  assert.ok(message.includes('Subject: Lesson feedback'));
  assert.ok(message.includes('Demo feedback'));
  assert.deepEqual(result.envelope.to, ['parent@example.invalid']);
});
