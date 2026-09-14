import assert from 'node:assert/strict';
import test from 'node:test';
import { timeClockRequest } from '../lib/timeClockRequest';

test('clock request returns server confirmations and bounds unresponsive requests', async (t) => {
  const stub = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ok: true}), {status: 200}));
  assert.equal((await timeClockRequest('/api/time-clock')).json.ok, true);
  stub.mock.mockImplementation(((_input: any, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  })) as any);
  await assert.rejects(timeClockRequest('/api/time-clock', {}, 10), /too long to confirm/);
  assert.equal(stub.mock.callCount(), 2, 'A write is not silently sent twice after a timeout');
  stub.mock.mockImplementation(async () => new Response('<html>Service unavailable</html>', { status: 503 }));
  await assert.rejects(timeClockRequest('/api/time-clock'), /unreadable response/);
});
