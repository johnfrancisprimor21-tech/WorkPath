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
  perJob,
  responseRate
} from './statistics.js';
import { buildReportModel, renderReportHtml } from './report.js';
import { formatMoney } from './money.js';

const today = '2026-10-16';
const range = 3;
const rangeDates = monthRange(today, range);
const profile = { currency: 'PHP', timezone: 'Asia/Manila' };
const employments = [{ id: 'job-1', employer_name: 'Report Co', job_title: 'Analyst', hourly_rate: 20 }];
const shifts = [
  { id: 'shift-1', employment_id: 'job-1', work_date: '2026-09-02', day_type: 'duty', worked_minutes: 480, is_overtime: false },
  { id: 'shift-2', employment_id: 'job-1', work_date: '2026-10-08', day_type: 'duty', worked_minutes: 60, is_overtime: true },
  { id: 'shift-3', employment_id: null, work_date: '2026-10-09', day_type: 'holiday', worked_minutes: 0, is_overtime: false }
];
const payrollEntries = [
  { id: 'pay-1', employment_id: 'job-1', pay_date: '2026-09-15', period_start: '2026-09-01', period_end: '2026-09-14', gross: 200, deductions: 20, net: 180 },
  { id: 'pay-2', employment_id: null, pay_date: '2026-10-15', period_start: null, period_end: null, gross: null, deductions: 0, net: 75.25 }
];

test('employed report calculations match shared statistics and payday totals use integer cents', () => {
  const model = buildReportModel({
    mode: 'employed', profile, today, range, rangeDates, shifts, payrollEntries, employments,
    generatedAt: '2026-10-16T12:00:00.000Z'
  });
  assert.deepEqual(model.charts.hoursWeeks, hoursByWeek(shifts, today, 8));
  assert.deepEqual(model.charts.hoursMonths, hoursByMonth(shifts, today, range));
  assert.deepEqual(model.charts.overtimeMonths, overtimeByMonth(shifts, today, range));
  assert.deepEqual(model.charts.daysMonths, dutyDaysByMonth(shifts, today, range));
  assert.deepEqual(model.charts.earningsMonths, earningsByMonth({ payrollEntries, shifts, employments, endDate: today, count: range }));
  assert.deepEqual(model.jobs, perJob({ shifts, employments, payrollEntries, fromDate: rangeDates.fromDate, toDate: rangeDates.toDate }));
  assert.deepEqual(model.paydays.totalsCents, { gross: 20000, deductions: 2000, net: 25525 });
  assert.equal(model.summary[0].minutes, 540);
  assert.equal(model.summary[1].minutes, 60);
  assert.equal(model.summary[2].value, '2');
  const html = renderReportHtml(model);
  assert.match(html, /Received \(net\)/);
  assert.match(html, /Estimated \(hours × rate\)/);
  assert.match(html, /No employer/);
  assert.match(html, /Totals/);
  assert.match(html, /exclude overtime premiums and unrated shifts/);
});

test('job seeker report excludes private fields and escapes user-provided markup', () => {
  const maliciousName = '<b>x</b><script>alert(1)</script>';
  const applications = [{
    id: 'app-1', date_applied: '2026-10-01', company: maliciousName, position: 'Support', status: 'interview',
    source: 'Company site', contact_name: 'Private contact', contact_email: 'private@example.test',
    job_url: 'https://private.example.test', notes: 'Private note'
  }];
  const model = buildReportModel({
    mode: 'job_seeker',
    profile: { ...profile, display_name: 'Private profile name', email: 'private-account@example.test' },
    today,
    applications,
    generatedAt: '2026-10-16T12:00:00.000Z'
  });
  assert.deepEqual(model.statusCounts, applicationsByStatus(applications));
  assert.deepEqual(model.charts.applicationsWeeks, applicationsByWeek(applications, today, 8));
  assert.deepEqual(model.charts.applicationsMonths, applicationsByMonth(applications, today, 6));
  assert.deepEqual(model.response, responseRate(applications));
  const html = renderReportHtml(model);
  assert.match(html, /Not enough data yet/);
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes(maliciousName));
  for (const privateValue of [
    'Private contact', 'private@example.test', 'private.example.test', 'Private note',
    'Private profile name', 'private-account@example.test'
  ]) {
    assert.ok(!html.includes(privateValue));
  }
});

test('empty reports show a message instead of empty charts', () => {
  const employed = buildReportModel({ mode: 'employed', profile, today, range, rangeDates, generatedAt: '2026-10-16T12:00:00.000Z' });
  const seeker = buildReportModel({ mode: 'job_seeker', profile, today, applications: [], generatedAt: '2026-10-16T12:00:00.000Z' });
  for (const model of [employed, seeker]) {
    const html = renderReportHtml(model);
    assert.equal(model.empty, true);
    assert.match(html, /No data in this range/);
    assert.ok(!html.includes('<svg'));
  }
});

test('job seeker report marks a truncated list and formats generated time in the profile zone', () => {
  const applications = Array.from({ length: 2 }, (_, index) => ({
    date_applied: '2026-10-01', company: `Company ${index}`, position: 'Role', status: 'pending', source: ''
  }));
  const generatedAt = '2026-01-01T01:30:00.000Z';
  const timezone = 'America/Los_Angeles';
  const model = buildReportModel({
    mode: 'job_seeker', profile: { currency: 'USD', timezone }, today,
    applications, applicationLimit: 2, generatedAt
  });
  const expectedTime = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone, dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date(generatedAt));
  assert.equal(model.truncated, true);
  assert.equal(model.header.generatedAt, expectedTime);
  assert.match(renderReportHtml(model), /Showing the most recent 2 applications/);

  const currency = 'EUR';
  const payModel = buildReportModel({
    mode: 'employed',
    profile: { currency, timezone, display_name: 'Private profile name' },
    today,
    range,
    rangeDates,
    payrollEntries: [{ pay_date: '2026-10-15', gross: 1234.5, deductions: 23.45, net: 1211.05 }],
    generatedAt
  });
  const payHtml = renderReportHtml(payModel);
  assert.ok(payHtml.includes(formatMoney(1234.5, currency)));
  assert.ok(!payHtml.includes('Private profile name'));
});
