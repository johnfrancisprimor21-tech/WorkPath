import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWorkedMinutes } from '../shared/hours.js';
import { parseCsv } from './csv.js';
import { CSV_FORMATS, detectCsvList, exportCsv, mapCsvImport } from './csv-mappers.js';

const profile = { currency: 'PHP', timezone: 'Asia/Manila', pay_frequency: 'weekly' };

function map(text, list, options = {}) {
  return mapCsvImport(parseCsv(text), list, { profile, ...options });
}

function errorFor(result, row, column) {
  return result.parsed.errors.find((error) => error.row === row && error.column === column);
}

test('CSV detection uses required headers, ignores case and order, and reports ambiguous headers', () => {
  assert.equal(detectCsvList(['NET', 'Pay_Date']), 'payrollEntries');
  assert.equal(detectCsvList(['company', 'position', 'status', 'date_applied']), 'applications');
  assert.equal(detectCsvList(['work_date', 'day_type', 'employer_name', 'net', 'pay_date']), null);
  assert.equal(detectCsvList(['unknown', 'columns']), null);
});

test('job mapper validates rate, dates and boolean columns with spreadsheet row and column', () => {
  const result = map('employer_name,hourly_rate,start_date,end_date,is_current\nAcme,$20,10/15/2026,01/01/2026,maybe', 'employments');
  for (const column of ['hourly_rate', 'start_date', 'end_date', 'is_current']) {
    assert.equal(errorFor(result, 2, column)?.message.length > 0, true, column);
  }
  assert.equal(result.parsed.data.employments.length, 0);
  const reversed = map('employer_name,start_date,end_date\nAcme,2026-02-01,2026-01-01', 'employments');
  assert.match(errorFor(reversed, 2, 'end_date').message, /not be before/);
});

test('date and time mapper rejects Excel dates and 12-hour times with accepted formats', () => {
  const shift = map('work_date,day_type,time_in,time_out\n10/15/2026,duty,10:00 PM,06:00', 'shifts');
  assert.match(errorFor(shift, 2, 'work_date').message, /YYYY-MM-DD/);
  assert.match(errorFor(shift, 2, 'time_in').message, /24-hour HH:MM/);
  const payroll = map('pay_date,net\n10/15/2026,50.00', 'payrollEntries');
  assert.match(errorFor(payroll, 2, 'pay_date').message, /YYYY-MM-DD/);
});

test('payday mapper validates each amount column and rejects commas, currency, exponent and excess decimals', () => {
  for (const value of ['1,000.00', '$20', '1e3', '12.345', '-2']) {
    const result = map(`pay_date,net,gross,deductions\n2026-10-15,"${value}",,`, 'payrollEntries');
    assert.equal(errorFor(result, 2, 'net')?.message.length > 0, true, value);
  }
  const result = map('pay_date,net,gross,deductions\n2026-10-15,10.00,nope,1.2.3', 'payrollEntries');
  assert.ok(errorFor(result, 2, 'gross'));
  assert.ok(errorFor(result, 2, 'deductions'));
  const outOfRange = map('pay_date,net\n2026-10-15,10000000000.00', 'payrollEntries');
  assert.match(errorFor(outOfRange, 2, 'net').message, /must not exceed/);
  const period = map('pay_date,period_start,period_end,net\n2026-10-15,2026-10-10,2026-10-01,20', 'payrollEntries');
  assert.match(errorFor(period, 2, 'period_end').message, /not be before/);
});

test('boolean variants are case-insensitive and invalid values identify the column', () => {
  const result = map('employer_name,is_current\nA,YES\nB,False\nC,1\nD,0\nE,enabled', 'employments');
  assert.deepEqual(result.parsed.data.employments.map((job) => job.is_current), [true, false, true, false]);
  assert.ok(errorFor(result, 6, 'is_current'));
});

test('enum errors list allowed day types and application statuses', () => {
  const shift = map('work_date,day_type\n2026-10-15,work', 'shifts');
  assert.match(errorFor(shift, 2, 'day_type').message, /duty, off, leave, sick, holiday/);
  const application = map('company,position,date_applied,status\nAcme,Analyst,2026-10-15,waiting', 'applications');
  assert.match(errorFor(application, 2, 'status').message, /pending, interview, offer, rejected, no_response/);
});

test('application mapper validates required values, URL and contact email by column', () => {
  const result = map('company,position,date_applied,status,job_url,contact_email\n, ,2026-10-15,pending,ftp://example.test,a@', 'applications');
  for (const column of ['company', 'position', 'job_url', 'contact_email']) assert.ok(errorFor(result, 2, column));
});

test('job references report unknown and ambiguous jobs with candidates', () => {
  const unknown = map('work_date,day_type,employer_name,job_title\n2026-10-15,duty,Missing,Role', 'shifts');
  assert.match(errorFor(unknown, 2, 'employer_name').message, /Job not found: Missing\. Import or add your jobs first\./);
  const employments = [
    { id: 'job-a', employer_name: 'Acme', job_title: 'Analyst', start_date: '2024-01-01' },
    { id: 'job-b', employer_name: ' ACME ', job_title: 'Analyst', start_date: '2025-01-01' }
  ];
  const ambiguous = map('work_date,day_type,employer_name,job_title\n2026-10-15,duty,Acme,Analyst', 'shifts', { employments });
  assert.match(errorFor(ambiguous, 2, 'employer_name').message, /ambiguous:.*2024-01-01.*2025-01-01/);
});

test('unknown columns warn, formula-protected text is restored, and markup remains data text', () => {
  const result = map('employer_name,job_title,is_current,extra\n\'=Acme,<b>x</b><script>alert(1)</script>,yes,ignored', 'employments');
  assert.equal(result.parsed.data.employments[0].employer_name, '=Acme');
  assert.equal(result.parsed.data.employments[0].job_title, '<b>x</b><script>alert(1)</script>');
  assert.match(result.parsed.warnings.join(' '), /Ignored columns: extra/);
});

test('overnight local shift conversion uses zone rules and computes 420 minutes', () => {
  const result = map('work_date,day_type,time_in,time_out,break_minutes,timezone\n2026-10-15,duty,22:00,06:00,60,Asia/Manila', 'shifts');
  const shift = result.parsed.data.shifts[0];
  assert.equal(computeWorkedMinutes(shift), 420);
  const equalTime = map('work_date,day_type,time_in,time_out\n2026-10-15,duty,22:00,22:00', 'shifts');
  assert.equal(new Date(equalTime.parsed.data.shifts[0].time_out).getTime()
    - new Date(equalTime.parsed.data.shifts[0].time_in).getTime(), 24 * 60 * 60 * 1000);
});

test('DST gaps are errors, overlaps use the first occurrence, and alternate zones warn', () => {
  const gap = map('work_date,day_type,time_in,timezone\n2026-03-08,duty,02:30,America/New_York', 'shifts');
  assert.match(errorFor(gap, 2, 'time_in').message, /does not exist/);
  const repeated = map('work_date,day_type,time_in,timezone\n2026-11-01,duty,01:30,America/New_York', 'shifts');
  assert.equal(repeated.parsed.data.shifts[0].time_in, '2026-11-01T05:30:00.000Z');
  assert.match(repeated.parsed.warnings.join(' '), /America\/New_York/);
  const invalid = map('work_date,day_type,time_in,timezone\n2026-10-15,duty,09:00,Not/AZone', 'shifts');
  assert.ok(errorFor(invalid, 2, 'timezone'));
});

test('blank employers mean no job, and non-duty days cannot have times', () => {
  const result = map('work_date,day_type,time_in\n2026-10-15,off,09:00', 'shifts');
  assert.ok(errorFor(result, 2, 'time_in'));
  const noJob = map('work_date,day_type,employer_name\n2026-10-15,duty,', 'shifts');
  assert.equal(noJob.parsed.data.shifts[0].employment_id, null);
});

test('formats contain the specified columns and events remain export-only', () => {
  assert.deepEqual(CSV_FORMATS.applicationEvents.headers, [
    'company', 'position', 'date_applied', 'event_type', 'event_date', 'event_time', 'notes'
  ]);
  const text = exportCsv('applicationEvents', {
    applications: [{ id: 'app-1', company: 'A', position: 'B', date_applied: '2026-10-15' }],
    applicationEvents: [{ application_id: 'app-1', event_type: 'interview', event_date: '2026-10-15T01:00:00.000Z', notes: '' }]
  }, profile);
  assert.match(text, /2026-10-15,09:00/);
});
