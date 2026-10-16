import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, parseBackup } from './backup-format.js';
import { planImport } from './importer.js';

const IDS = {
  employment: '11111111-1111-4111-8111-111111111111',
  shift: '22222222-2222-4222-8222-222222222222',
  payroll: '33333333-3333-4333-8333-333333333333',
  application: '44444444-4444-4444-8444-444444444444',
  event: '55555555-5555-4555-8555-555555555555'
};

function sampleBackup() {
  return buildBackup({
    source: 'account',
    exportedAt: '2026-10-15T12:00:00.000Z',
    profile: {
      display_name: 'Backup User', mode: 'employed', currency: 'USD',
      pay_frequency: 'weekly', timezone: 'UTC', email: 'auth@example.test', onboarded: true
    },
    employments: [{
      id: IDS.employment, user_id: '66666666-6666-4666-8666-666666666666',
      employer_name: 'Sample Co', job_title: 'Engineer', hourly_rate: 24,
      start_date: '2025-01-01', end_date: null, is_current: true, created_at: '2025-01-01T00:00:00.000Z'
    }],
    shifts: [{
      id: IDS.shift, user_id: '66666666-6666-4666-8666-666666666666',
      employment_id: IDS.employment, work_date: '2025-02-03', day_type: 'duty',
      time_in: '2025-02-03T09:00:00.000Z', time_out: '2025-02-03T17:00:00.000Z',
      break_minutes: 30, is_overtime: false, notes: 'Shift', worked_minutes: 450
    }],
    payrollEntries: [{
      id: IDS.payroll, user_id: '66666666-6666-4666-8666-666666666666',
      employment_id: IDS.employment, pay_date: '2025-02-14', period_start: '2025-01-27',
      period_end: '2025-02-09', gross: 1000, deductions: 100, net: 900, notes: 'Pay'
    }],
    applications: [{
      id: IDS.application, user_id: '66666666-6666-4666-8666-666666666666',
      company: 'Hiring Co', position: 'Analyst', source: null, job_url: null, location: null,
      date_applied: '2025-03-01', status: 'pending', contact_name: null, contact_email: 'contact@example.test',
      notes: null, updated_at: '2025-03-01T00:00:00.000Z'
    }],
    applicationEvents: [{
      id: IDS.event, user_id: '66666666-6666-4666-8666-666666666666',
      application_id: IDS.application, event_type: 'note',
      event_date: '2025-03-02T01:00:00.000Z', notes: 'Sent a note'
    }]
  });
}

function encoded(value) {
  return JSON.stringify(value);
}

test('backup format round-trips supported user data and omits identity and managed fields', () => {
  const backup = sampleBackup();
  const result = parseBackup(encoded(backup));
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.data, backup);
  assert.equal(result.data.shifts[0].worked_minutes, undefined);
  assert.equal(result.data.applications[0].updated_at, undefined);
  assert.equal(result.data.applications[0].contact_email, 'contact@example.test');
  const json = encoded(backup);
  assert.equal(/\"user_id\"\s*:/.test(json), false);
  assert.equal(/\"email\"\s*:/.test(json), false);
  assert.equal(/\"updated_at\"\s*:|\"created_at\"\s*:|\"worked_minutes\"\s*:/.test(json), false);
  assert.equal(backup.exportedAt.endsWith('Z'), true);
});

test('backup parser rejects malformed JSON, wrong app, missing or unsupported version', () => {
  assert.match(parseBackup('{').errors[0].message, /valid JSON/i);
  assert.match(parseBackup(encoded({ ...sampleBackup(), app: 'other' })).errors[0].message, /Workpath backup/i);
  const missingVersion = sampleBackup();
  delete missingVersion.formatVersion;
  assert.match(parseBackup(encoded(missingVersion)).errors[0].message, /missing its format version/i);
  assert.match(parseBackup(encoded({ ...sampleBackup(), formatVersion: 2 })).errors[0].message, /newer version/i);
  assert.match(parseBackup(encoded({ ...sampleBackup(), formatVersion: 0 })).errors[0].message, /not supported/i);
});

test('parser rejects non-list sections and lists over 20,000 records', () => {
  const notArray = parseBackup(encoded({ ...sampleBackup(), shifts: {} }));
  assert.deepEqual(notArray.errors.map(({ list, row }) => [list, row]), [['shifts', 0]]);
  const tooMany = parseBackup(encoded({ ...sampleBackup(), shifts: Array.from({ length: 20_001 }, () => ({})) }));
  assert.equal(tooMany.errors.some((error) => error.list === 'shifts' && /20,000/.test(error.message)), true);
  assert.equal(planImport(tooMany, {}).canRun, false);
  assert.equal(planImport(notArray, {}).canRun, false);
});

test('parser drops unknown fields and reports all row errors with 1-based positions', () => {
  const backup = sampleBackup();
  backup.unexpected = 'drop me';
  backup.employments[0].secret_extra = true;
  backup.shifts[0].work_date = '2025-02-31';
  backup.shifts.push({
    ...backup.shifts[0],
    id: '77777777-7777-4777-8777-777777777777',
    work_date: '2025-02-04',
    employment_id: '88888888-8888-4888-8888-888888888888'
  });
  const result = parseBackup(encoded(backup));
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map(({ list, row }) => [list, row]), [
    ['shifts', 1], ['shifts', 2]
  ]);
  assert.match(result.errors[0].message, /required shift details|shift times/i);
  assert.match(result.errors[1].message, /missing from the backup/i);
  assert.equal(result.data.shifts.length, 0);
  assert.equal(result.data.employments[0].secret_extra, undefined);
  assert.equal(result.warnings.includes('Unknown fields were ignored.'), true);
});

test('parser reports missing application links and preserves user-entered calendar dates', () => {
  const backup = sampleBackup();
  backup.applicationEvents[0].application_id = '99999999-9999-4999-8999-999999999999';
  const result = parseBackup(encoded(backup));
  assert.equal(result.errors.some((error) => error.list === 'applicationEvents'
    && error.row === 1 && /missing from the backup/i.test(error.message)), true);
  assert.equal(result.data.payrollEntries[0].pay_date, '2025-02-14');
  assert.equal(result.data.applicationEvents.length, 0);
});
