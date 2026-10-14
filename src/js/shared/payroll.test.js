import test from 'node:test';
import assert from 'node:assert/strict';
import { compareToEstimate, estimatePay, findPeriodAnchor, getPayPeriod } from './payroll.js';
import { computeWorkedMinutes } from './hours.js';

test('weekly periods use Monday boundaries and an anchored cycle in both directions', () => {
  assert.deepEqual(getPayPeriod('2026-08-31', 'weekly'), { start: '2026-08-31', end: '2026-09-06' });
  assert.deepEqual(getPayPeriod('2026-09-06', 'weekly'), { start: '2026-08-31', end: '2026-09-06' });
  assert.deepEqual(getPayPeriod('2026-05-07', 'weekly', '2026-05-08'), { start: '2026-05-01', end: '2026-05-07' });
});

test('semi-monthly periods handle leap February and month ends', () => {
  assert.deepEqual(getPayPeriod('2024-02-15', 'semi_monthly'), { start: '2024-02-01', end: '2024-02-15' });
  assert.deepEqual(getPayPeriod('2024-02-16', 'semi_monthly'), { start: '2024-02-16', end: '2024-02-29' });
  assert.deepEqual(getPayPeriod('2025-03-31', 'semi_monthly'), { start: '2025-03-16', end: '2025-03-31' });
});

test('monthly and biweekly periods cross leap days and year boundaries', () => {
  assert.deepEqual(getPayPeriod('2024-02-29', 'monthly'), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(getPayPeriod('2025-01-01', 'monthly'), { start: '2025-01-01', end: '2025-01-31' });
  assert.deepEqual(getPayPeriod('2025-01-01', 'biweekly', '2024-12-30'), { start: '2024-12-30', end: '2025-01-12' });
  assert.deepEqual(getPayPeriod('2024-12-29', 'biweekly', '2024-12-30'), { start: '2024-12-16', end: '2024-12-29' });
  assert.equal(getPayPeriod('2025-01-01', 'biweekly'), null);
});

test('findPeriodAnchor chooses the latest entry that has a period start', () => {
  assert.equal(findPeriodAnchor([
    { id: 'b', pay_date: '2025-03-01', period_start: null },
    { id: 'c', pay_date: '2025-02-20', period_start: '2025-02-01' },
    { id: 'a', pay_date: '2025-03-01', period_start: '2025-02-15' }
  ]), '2025-02-15');
  assert.equal(findPeriodAnchor([]), null);
});

test('estimates rated duty shifts, rounds grouped employment cents, and excludes unrated work', () => {
  const overnight = {
    employment_id: 'rated', work_date: '2025-01-01', day_type: 'duty',
    time_in: '2025-01-01T22:00:00Z', time_out: '2025-01-02T06:00:00Z', break_minutes: 60,
    is_overtime: true
  };
  overnight.worked_minutes = computeWorkedMinutes(overnight);
  assert.equal(overnight.worked_minutes, 420);
  assert.deepEqual(estimatePay({
    employments: [{ id: 'rated', hourly_rate: 20 }],
    shifts: [overnight], fromDate: '2025-01-01', toDate: '2025-01-01'
  }), { totalCents: 14000, minutesRated: 420, minutesUnrated: 0, shiftsUnrated: 0 });

  assert.equal(estimatePay({
    employments: [{ id: 'rounded', hourly_rate: 10.01 }],
    shifts: [1, 2].map((day) => ({ employment_id: 'rounded', work_date: `2025-01-0${day}`, day_type: 'duty', worked_minutes: 1 })),
    fromDate: '2025-01-01', toDate: '2025-01-02'
  }).totalCents, 33);

  assert.deepEqual(estimatePay({
    employments: [{ id: 'no-rate', hourly_rate: null }],
    shifts: [
      { employment_id: 'no-rate', work_date: '2025-01-01', day_type: 'duty', worked_minutes: 90 },
      { employment_id: null, work_date: '2025-01-02', day_type: 'duty', worked_minutes: 30 },
      { employment_id: 'no-rate', work_date: '2025-01-03', day_type: 'off', worked_minutes: 50 }
    ], fromDate: '2025-01-01', toDate: '2025-01-02'
  }), { totalCents: 0, minutesRated: 0, minutesUnrated: 120, shiftsUnrated: 2 });
});

test('gross comparison handles one-percent, missing-data, and zero-estimate cases', () => {
  const entry = { gross: 99, period_start: '2025-01-01', period_end: '2025-01-31' };
  assert.deepEqual(compareToEstimate(entry, 10000, 60), { status: 'matches', differenceCents: 100 });
  assert.deepEqual(compareToEstimate({ ...entry, gross: 101.01 }, 10000, 60), { status: 'above', differenceCents: 101 });
  assert.deepEqual(compareToEstimate({ ...entry, gross: 98.99 }, 10000, 60), { status: 'below', differenceCents: 101 });
  assert.equal(compareToEstimate({ ...entry, gross: null }, 10000, 60), null);
  assert.equal(compareToEstimate({ ...entry, period_end: null }, 10000, 60), null);
  assert.equal(compareToEstimate({ ...entry, gross: 0 }, 0, 0), null);
  assert.equal(compareToEstimate({ ...entry, gross: 0 }, 0, 60).status, 'matches');
  assert.equal(compareToEstimate({ ...entry, gross: 0.01 }, 0, 60).status, 'above');
});
