import assert from 'node:assert/strict';
import test from 'node:test';
import adminTimeClockHandler from '../pages/api/admin/time-clock';
import publicTimeClockHandler from '../pages/api/time-clock';
import { createSessionToken, SESSION_COOKIE } from '../lib/session';

function responseRecorder() {
  const result: { status: number; body: any; headers: Record<string, unknown> } = {
    status: 200,
    body: null,
    headers: {},
  };
  const response = {
    setHeader(name: string, value: unknown) {
      result.headers[name] = value;
    },
    status(status: number) {
      result.status = status;
      return response;
    },
    json(body: any) {
      result.body = body;
      return response;
    },
  };
  return { response: response as any, result };
}

test('Time Clock APIs reject an unsigned request', async () => {
  const publicResult = responseRecorder();
  await publicTimeClockHandler(
    { method: 'GET', headers: {}, query: {} } as any,
    publicResult.response,
  );
  assert.equal(publicResult.result.status, 401);
  assert.equal(publicResult.result.body.code, 'AUTH_REQUIRED');

  const adminResult = responseRecorder();
  await adminTimeClockHandler(
    { method: 'GET', headers: {}, query: {} } as any,
    adminResult.response,
  );
  assert.equal(adminResult.result.status, 401);
  assert.equal(adminResult.result.body.code, 'AUTH_REQUIRED');
});

test('a signed tutor session cannot access the admin Time Clock API', async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'time-clock-test-session-secret';
  try {
    const token = await createSessionToken({
      tutor: 'Test Tutor',
      campus: 'test-campus',
      role: 'tutor',
    });
    const recorder = responseRecorder();
    await adminTimeClockHandler(
      {
        method: 'GET',
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
        query: {},
      } as any,
      recorder.response,
    );
    assert.equal(recorder.result.status, 403);
    assert.equal(recorder.result.body.code, 'ADMIN_REQUIRED');
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});
