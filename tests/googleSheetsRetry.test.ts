import test from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableGoogleSheetsStatus } from '../lib/googleSheets';
import { isMissingTimeClockSheetError } from '../lib/timeClock';

test('retries only safe transient Google Sheets read failures', () => {
  assert.equal(isRetryableGoogleSheetsStatus(429), true);
  assert.equal(isRetryableGoogleSheetsStatus(500), true);
  assert.equal(isRetryableGoogleSheetsStatus(503), true);
  assert.equal(isRetryableGoogleSheetsStatus(400), false);
  assert.equal(isRetryableGoogleSheetsStatus(403), false);
});

test('recognises a missing owned Time Clock tab without masking other failures', () => {
  assert.equal(
    isMissingTimeClockSheetError(new Error("Unable to parse range: 'time_clock_events'!A:ZZ")),
    true,
  );
  assert.equal(
    isMissingTimeClockSheetError(new Error('Quota exceeded for quota metric Read requests')),
    false,
  );
  assert.equal(
    isMissingTimeClockSheetError(new Error('Caller does not have permission')),
    false,
  );
});
