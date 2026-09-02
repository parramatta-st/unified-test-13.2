import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyLocation } from '../lib/timeClock';

test('geofence is calculated server-side from coordinates and accuracy', () => {
  const previous = {
    latitude: process.env.TIME_CLOCK_LATITUDE,
    longitude: process.env.TIME_CLOCK_LONGITUDE,
    radius: process.env.TIME_CLOCK_RADIUS_METRES,
    accuracy: process.env.TIME_CLOCK_MAX_ACCURACY_METRES,
  };
  process.env.TIME_CLOCK_LATITUDE = '0';
  process.env.TIME_CLOCK_LONGITUDE = '0';
  process.env.TIME_CLOCK_RADIUS_METRES = '150';
  process.env.TIME_CLOCK_MAX_ACCURACY_METRES = '200';
  try {
    const atCentre = verifyLocation({
      latitude: 0,
      longitude: 0,
      accuracy: 12,
    });
    assert.equal(atCentre.ok, true);
    assert.equal(atCentre.code, 'LOCATION_VERIFIED');
    assert.equal(atCentre.distanceM, 0);

    const outside = verifyLocation({
      latitude: 0.01,
      longitude: 0,
      accuracy: 12,
    });
    assert.equal(outside.ok, false);
    assert.equal(outside.code, 'OUTSIDE_GEOFENCE');
    assert.ok((outside.distanceM || 0) > 1_000);

    const inaccurate = verifyLocation({
      latitude: 0,
      longitude: 0,
      accuracy: 250,
    });
    assert.equal(inaccurate.ok, false);
    assert.equal(inaccurate.code, 'LOCATION_INACCURATE');
  } finally {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('TIME_CLOCK_LATITUDE', previous.latitude);
    restore('TIME_CLOCK_LONGITUDE', previous.longitude);
    restore('TIME_CLOCK_RADIUS_METRES', previous.radius);
    restore('TIME_CLOCK_MAX_ACCURACY_METRES', previous.accuracy);
  }
});
