import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applicationsByMonth,
  applicationsByStatus,
  applicationsByWeek,
  dutyDaysByMonth,
  earningsByMonth,
  hoursByMonth,
  hoursByWeek,
  monthRange,
  overtimeByMonth,
  overtimeByWeek,
  perJob,
  responseRate
} from './statistics.js';

test('week buckets start Monday, include empty buckets, and cross a year boundary', () => {
  const rows = hoursByWeek([
    shift('2024-12-31', 420),
    shift('2025-01-02', 60)
  ], '2025-01-02', 2);
  assert.deepEqual(rows.map(({ startDate, endDate, workedMinutes }) => ({ startDate, endDate, workedMinutes })), [
    { startDate: '2024-12-23', endDate: '2024-12-29', workedMinutes: 0 },
    { startDate: '2024-12-30', endDate: '2025-01-05', workedMinutes: 480 }
  ]);
});

test('monthly buckets handle leap February and include empty months', () => {
  assert.deepEqual(hoursByMonth([shift('2024-02-29', 420)], '2024-03-01', 3).map((row) => [row.month, row.workedMinutes]), [
    ['2024-01', 0], ['2024-02', 420], ['2024-03', 0]
  ]);
  assert.deepEqual(monthRange('2024-03-02', 2), { fromDate: '2024-02-01', toDate: '2024-03-31' });
});

test('multiple shifts on one date sum hours but duty and off days count distinct dates', () => {
  const shifts = [
    shift('2024-02-29', 240),
    shift('2024-02-29', 180),
    shift('2024-02-29', 0, { day_type: 'leave' }),
    shift('2024-02-28', 0, { day_type: 'off' }),
    shift('2024-03-01', 0, { day_type: 'holiday' })
  ];
  assert.equal(hoursByMonth(shifts, '2024-03-01', 2)[0].workedMinutes, 420);
  assert.deepEqual(dutyDaysByMonth(shifts, '2024-03-01', 2).map((row) => [row.month, row.dutyDays, row.offDays]), [
    ['2024-02', 1, 1], ['2024-03', 0, 1]
  ]);
});

test('overnight shift is counted on work_date, and overtime sums only flagged duty minutes', () => {
  const shifts = [
    shift('2024-03-04', 420, { is_overtime: true, time_in: '2024-03-04T22:00:00Z', time_out: '2024-03-05T06:00:00Z' }),
    shift('2024-03-05', 60, { is_overtime: false }),
    shift('2024-03-06', 90, { is_overtime: true, day_type: 'off' })
  ];
  assert.deepEqual(hoursByWeek(shifts, '2024-03-06', 1).map((row) => row.workedMinutes), [480]);
  assert.deepEqual(overtimeByWeek(shifts, '2024-03-06', 1).map((row) => row.workedMinutes), [420]);
  assert.deepEqual(overtimeByMonth(shifts, '2024-03-06', 1).map((row) => row.workedMinutes), [420]);
});

test('empty datasets return ordered zero buckets and response rate handles empty input', () => {
  assert.deepEqual(hoursByWeek([], '2025-01-02', 1).map((row) => row.workedMinutes), [0]);
  assert.deepEqual(hoursByMonth([], '2025-01-02', 2).map((row) => row.workedMinutes), [0, 0]);
  assert.deepEqual(dutyDaysByMonth([], '2025-01-02', 1).map((row) => [row.dutyDays, row.offDays]), [[0, 0]]);
  assert.deepEqual(responseRate([]), { responded: 0, total: 0, rate: null });
});

test('monthly earnings use null without a payday and integer cents with unrated shifts', () => {
  const rows = earningsByMonth({
    payrollEntries: [{ pay_date: '2024-02-10', net: 123.45 }],
    shifts: [shift('2024-02-29', 420, { employment_id: null })],
    employments: [],
    endDate: '2024-03-10',
    count: 2
  });
  assert.deepEqual(rows.map((row) => row.netReceivedCents), [12345, null]);
  assert.equal(rows[0].estimatedCents, 0);
  assert.equal(rows[0].minutesUnrated, 420);
  assert.equal(rows[0].shiftsUnrated, 1);
});

test('per-job totals separate employment and no-employer shifts and paydays', () => {
  const employments = [
    { id: 'job-a', employer_name: 'Rated Co', job_title: null, hourly_rate: 20 },
    { id: 'job-b', employer_name: 'Unrated Co', job_title: 'Assistant', hourly_rate: null }
  ];
  const rows = perJob({
    shifts: [
      shift('2024-04-01', 60, { employment_id: 'job-a' }),
      shift('2024-04-02', 120, { employment_id: 'job-b' }),
      shift('2024-04-03', 30, { employment_id: null })
    ],
    employments,
    payrollEntries: [
      { pay_date: '2024-04-04', employment_id: 'job-a', net: 15 },
      { pay_date: '2024-04-05', employment_id: null, net: 8 }
    ],
    fromDate: '2024-04-01',
    toDate: '2024-04-30'
  });
  assert.deepEqual(rows.map((row) => [row.label, row.minutes, row.estimatedCents, row.netReceivedCents]), [
    ['Rated Co', 60, 2000, 1500],
    ['Unrated Co · Assistant', 120, 0, 0],
    ['No employer', 30, 0, 800]
  ]);
});

test('application counts stay in UI status order and use date_applied buckets', () => {
  const applications = [
    { status: 'offer', date_applied: '2024-12-31' },
    { status: 'pending', date_applied: '2025-01-01' },
    { status: 'interview', date_applied: '2025-01-02' }
  ];
  assert.deepEqual(applicationsByStatus(applications), [
    { status: 'pending', count: 1 }, { status: 'interview', count: 1 }, { status: 'offer', count: 1 },
    { status: 'rejected', count: 0 }, { status: 'no_response', count: 0 }
  ]);
  assert.deepEqual(applicationsByWeek(applications, '2025-01-02', 2).map((row) => row.applications), [0, 3]);
  assert.deepEqual(applicationsByMonth(applications, '2025-01-02', 2).map((row) => row.applications), [1, 2]);
});

test('response rate is hidden below five applications and counts all non-pending statuses', () => {
  assert.deepEqual(responseRate([app('pending'), app('pending'), app('offer'), app('no_response')]), {
    responded: 2, total: 4, rate: null
  });
  assert.deepEqual(responseRate([
    app('pending'), app('pending'), app('offer'), app('no_response'), app('interview')
  ]), { responded: 3, total: 5, rate: 0.6 });
});

function shift(work_date, worked_minutes, overrides = {}) {
  return { id: `${work_date}-${worked_minutes}-${overrides.day_type || 'duty'}`, work_date, worked_minutes, day_type: 'duty', is_overtime: false, employment_id: 'job-a', ...overrides };
}

function app(status) {
  return { status };
}
