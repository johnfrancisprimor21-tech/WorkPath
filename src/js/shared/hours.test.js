import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWorkedMinutes } from './hours.js';

test('an overnight shift with a 60 minute break is 420 minutes', () => {
  assert.equal(computeWorkedMinutes({
    day_type: 'duty',
    time_in: '2026-10-12T14:00:00.000Z',
    time_out: '2026-10-12T22:00:00.000Z',
    break_minutes: 60
  }), 420);
});

test('an eight hour shift with a 30 minute break is 450 minutes', () => {
  assert.equal(computeWorkedMinutes({
    day_type: 'duty',
    time_in: '2026-01-01T08:00:00.000Z',
    time_out: '2026-01-01T16:00:00.000Z',
    break_minutes: 30
  }), 450);
});

test('non-duty day types return zero worked minutes', () => {
  for (const day_type of ['off', 'leave', 'sick', 'holiday']) {
    assert.equal(computeWorkedMinutes({ day_type, time_in: '2026-01-01T08:00:00Z', time_out: '2026-01-01T16:00:00Z' }), 0);
  }
});

test('missing or invalid times return zero worked minutes', () => {
  assert.equal(computeWorkedMinutes({ day_type: 'duty', time_in: null, time_out: null, break_minutes: 0 }), 0);
  assert.equal(computeWorkedMinutes({ day_type: 'duty', time_in: 'invalid', time_out: '2026-01-01T16:00:00Z' }), 0);
});

test('a break longer than the shift is clamped to zero', () => {
  assert.equal(computeWorkedMinutes({
    day_type: 'duty',
    time_in: '2026-01-01T08:00:00Z',
    time_out: '2026-01-01T08:20:00Z',
    break_minutes: 30
  }), 0);
});

test('elapsed seconds are reduced to whole minutes', () => {
  assert.equal(computeWorkedMinutes({
    day_type: 'duty',
    time_in: '2026-01-01T08:00:00.000Z',
    time_out: '2026-01-01T08:01:59.000Z',
    break_minutes: 0
  }), 1);
});
