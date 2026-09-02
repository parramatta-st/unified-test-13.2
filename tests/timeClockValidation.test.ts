import test from 'node:test';
import assert from 'node:assert/strict';
import { hasWrittenOverrideReason } from '../lib/timeClockValidation';

test('requires a written admin override reason without inventing a minimum length', () => {
  assert.equal(hasWrittenOverrideReason(''), false);
  assert.equal(hasWrittenOverrideReason('   '), false);
  assert.equal(hasWrittenOverrideReason('Test 1'), true);
  assert.equal(hasWrittenOverrideReason('GPS failed on tutor phone'), true);
});
