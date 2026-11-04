import test from 'node:test';
import assert from 'node:assert/strict';
import { addBusinessMinutes, businessMinutesBetween } from '../src/services/sla.js';

const cfg = { workdays: [1, 2, 3, 4, 5], start: '08:00', end: '17:00', holidays: [] };
const d = (s) => new Date(s); // local time

test('adds within the same working day', () => {
  assert.deepEqual(addBusinessMinutes(d('2026-11-04T09:00'), 60, cfg), d('2026-11-04T10:00'));
});
test('rolls over to the next working day', () => {
  assert.deepEqual(addBusinessMinutes(d('2026-11-04T16:30'), 60, cfg), d('2026-11-05T08:30'));
});
test('skips the weekend', () => {
  assert.deepEqual(addBusinessMinutes(d('2026-11-06T16:00'), 120, cfg), d('2026-11-09T09:00'));
});
test('starts counting at opening time when created out of hours', () => {
  assert.deepEqual(addBusinessMinutes(d('2026-11-04T22:00'), 30, cfg), d('2026-11-05T08:30'));
});
test('skips holidays', () => {
  assert.deepEqual(addBusinessMinutes(d('2026-11-04T16:00'), 120, { ...cfg, holidays: ['2026-11-05'] }), d('2026-11-06T09:00'));
});
test('24x7 when no workdays configured', () => {
  assert.deepEqual(addBusinessMinutes(d('2026-11-07T23:00'), 120, { workdays: [] }), d('2026-11-08T01:00'));
});
test('Sunday-Thursday week', () => {
  const sunThu = { ...cfg, workdays: [0, 1, 2, 3, 4] };
  // Thursday 16:00 + 2h -> Sunday 09:00
  assert.deepEqual(addBusinessMinutes(d('2026-11-05T16:00'), 120, sunThu), d('2026-11-08T09:00'));
});
test('business minutes between spans a weekend', () => {
  assert.equal(businessMinutesBetween(d('2026-11-06T16:00'), d('2026-11-09T09:00'), cfg), 120);
});
