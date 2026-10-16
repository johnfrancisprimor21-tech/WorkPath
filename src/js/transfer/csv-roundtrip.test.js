import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndexedDbRepo, deleteIndexedDbDatabase } from '../data/indexeddb-repo.js';
import { createMemoryRepo } from '../data/memory-repo.js';
import { localDateTimeToUtc } from '../shared/time.js';
import { parseCsv } from './csv.js';
import { exportCsv, mapCsvImport } from './csv-mappers.js';
import { planImport, runImport } from './importer.js';

let nextDb = 0;
const profileValues = { currency: 'PHP', timezone: 'Asia/Manila', pay_frequency: 'weekly', onboarded: true };

test('CSV round trips between memory and IndexedDB in both directions; duplicate import is idempotent', async () => {
  for (const sourceKind of ['memory', 'indexeddb']) {
    for (const targetKind of ['memory', 'indexeddb']) {
      const source = makeRepo(sourceKind);
      const target = makeRepo(targetKind);
      try {
        const sourceData = await seedSource(source);
        for (const list of ['employments', 'shifts', 'payrollEntries', 'applications']) {
          const text = exportCsv(list, sourceData, profileValues);
          const result = await importList(target, list, text);
          assert.equal(result.failures.length, 0, `${sourceKind} -> ${targetKind} ${list}`);
          assert.equal(result.created[list], 1);
          const duplicate = await importList(target, list, text);
          assert.equal(duplicate.failures.length, 0);
          assert.equal(duplicate.created[list], 0, `${sourceKind} -> ${targetKind} second ${list}`);
          assert.equal(duplicate.skipped[list], 1);
        }
        const actual = await readData(target);
        assert.equal(actual.employments[0].employer_name, 'Roundtrip, Acme');
        assert.equal(actual.employments[0].hourly_rate, 22.5);
        assert.equal(actual.shifts[0].employment_id, actual.employments[0].id);
        assert.equal(actual.shifts[0].worked_minutes, 420);
        assert.equal(actual.payrollEntries[0].employment_id, actual.employments[0].id);
        assert.equal(actual.payrollEntries[0].net, 950.5);
        assert.equal(actual.applications[0].contact_email, 'hello@example.test');
        assert.notEqual(actual.employments[0].id, sourceData.employments[0].id);
      } finally {
        source.close?.();
        target.close?.();
        await removeRepo(source);
        await removeRepo(target);
      }
    }
  }
});

test('shift CSV imported before its job exists reports the requested row error', async () => {
  const repo = makeRepo('memory');
  try {
    await repo.profile.get();
    const text = 'work_date,employer_name,job_title,day_type,time_in,time_out,break_minutes\n'
      + '2026-10-15,Missing Co,Role,duty,22:00,06:00,60';
    const result = await importList(repo, 'shifts', text);
    assert.equal(result.created.shifts, 0);
    assert.equal(result.errors[0].row, 2);
    assert.equal(result.errors[0].column, 'employer_name');
    assert.match(result.errors[0].message, /Job not found: Missing Co\. Import or add your jobs first\./);
  } finally {
    repo.close?.();
    await removeRepo(repo);
  }
});

async function seedSource(repo) {
  await repo.profile.get();
  await repo.profile.update(profileValues);
  const job = await repo.employments.create({
    employer_name: 'Roundtrip, Acme', job_title: 'Support', hourly_rate: 22.5,
    start_date: '2025-01-01', end_date: null, is_current: true
  });
  const shift = await repo.shifts.create({
    employment_id: job.id, work_date: '2026-10-15', day_type: 'duty',
    time_in: localDateTimeToUtc('2026-10-15', '22:00', 'Asia/Manila'),
    time_out: localDateTimeToUtc('2026-10-16', '06:00', 'Asia/Manila'),
    break_minutes: 60, is_overtime: false, notes: 'Overnight, notes'
  });
  const payday = await repo.payrollEntries.create({
    employment_id: job.id, pay_date: '2026-10-15', period_start: '2026-10-01', period_end: '2026-10-14',
    gross: 1000, deductions: 49.5, net: 950.5, notes: 'Payday'
  });
  const application = await repo.applications.create({
    company: 'Roundtrip App', position: 'Analyst', source: null, job_url: null,
    location: 'Manila', date_applied: '2026-10-14', status: 'pending', contact_name: null,
    contact_email: 'hello@example.test', notes: 'CSV test'
  });
  await repo.applicationEvents.create({
    application_id: application.id, event_type: 'interview',
    event_date: '2026-10-15T01:00:00.000Z', notes: 'Timeline event'
  });
  assert.equal(shift.worked_minutes, 420);
  assert.equal(payday.net, 950.5);
  return readData(repo);
}

async function readData(repo) {
  const [profile, employments, shifts, payrollEntries, applications] = await Promise.all([
    repo.profile.get(), repo.employments.list(), repo.shifts.listBetween('0001-01-01', '9999-12-31'),
    repo.payrollEntries.list(), repo.applications.list()
  ]);
  const groups = await Promise.all(applications.map((application) => repo.applicationEvents.listForApplication(application.id)));
  return { profile, employments, shifts, payrollEntries, applications, applicationEvents: groups.flat() };
}

async function importList(repo, list, text) {
  const existingData = await readData(repo);
  const mapped = mapCsvImport(parseCsv(text), list, {
    profile: existingData.profile,
    employments: existingData.employments
  });
  const plan = planImport(mapped.parsed, existingData, {
    skipDuplicates: true,
    applyProfileSettings: false,
    employmentIdAliases: mapped.employmentIdAliases
  });
  return runImport(repo, plan);
}

function makeRepo(kind) {
  const userId = globalThis.crypto.randomUUID();
  if (kind === 'memory') return createMemoryRepo({ getUserId: () => userId });
  const databaseName = `workpath-csv-${++nextDb}-${globalThis.crypto.randomUUID()}`;
  const repo = createIndexedDbRepo({ getUserId: () => userId, databaseName });
  repo.testDatabaseName = databaseName;
  return repo;
}

async function removeRepo(repo) {
  if (repo.testDatabaseName) await deleteIndexedDbDatabase(repo.testDatabaseName);
}
