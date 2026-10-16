import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { createMemoryRepo } from '../data/memory-repo.js';
import { createIndexedDbRepo } from '../data/indexeddb-repo.js';
import { deleteLocalDatabase, getReadOnlyLocalRepo } from '../data/index.js';
import { buildBackup, parseBackup } from './backup-format.js';
import { planImport, runImport } from './importer.js';

const ALL_DATES = ['0001-01-01', '9999-12-31'];

async function createMemory(userId) {
  const repo = createMemoryRepo({ getUserId: () => userId });
  await repo.profile.get();
  return repo;
}

async function createLocal(name) {
  const setupRepo = createIndexedDbRepo({ getUserId: () => null, databaseName: name });
  const userId = await setupRepo.getOrCreateLocalUserId();
  setupRepo.close();
  const repo = createIndexedDbRepo({ getUserId: () => userId, databaseName: name });
  await repo.profile.get();
  return repo;
}

async function setProfile(repo, values = {}) {
  return repo.profile.update({
    display_name: 'Transfer test',
    mode: 'employed',
    currency: 'USD',
    pay_frequency: 'weekly',
    timezone: 'UTC',
    onboarded: false,
    ...values
  });
}

async function seedRepo(repo, prefix = 'Source') {
  await setProfile(repo, { display_name: prefix + ' profile', currency: 'USD', mode: 'employed' });
  const job = await repo.employments.create({
    employer_name: prefix + ' Co', job_title: 'Analyst', hourly_rate: 25, start_date: '2025-01-01'
  });
  await repo.shifts.create({
    employment_id: job.id, work_date: '2025-02-03', day_type: 'duty',
    time_in: '2025-02-03T09:00:00.000Z', time_out: '2025-02-03T17:00:00.000Z',
    break_minutes: 30, is_overtime: false, notes: 'Shift note'
  });
  await repo.payrollEntries.create({
    employment_id: job.id, pay_date: '2025-02-14', period_start: '2025-01-27',
    period_end: '2025-02-09', gross: 1000, deductions: 100, net: 900, notes: 'Pay note'
  });
  const application = await repo.applications.create({
    company: prefix + ' Hiring', position: 'Designer', date_applied: '2025-03-01',
    status: 'interview', contact_email: 'contact@example.test', notes: 'Application note'
  });
  await repo.applicationEvents.create({
    application_id: application.id, event_type: 'interview',
    event_date: '2025-03-02T10:30:00.000Z', notes: 'Interview scheduled'
  });
  return { job, application };
}

async function readAll(repo) {
  const profile = await repo.profile.get();
  const employments = await repo.employments.list();
  const shifts = await repo.shifts.listBetween(...ALL_DATES);
  const payrollEntries = await repo.payrollEntries.list();
  const applications = await repo.applications.list();
  const applicationEvents = [];
  for (const application of applications) {
    applicationEvents.push(...await repo.applicationEvents.listForApplication(application.id));
  }
  return { profile, employments, shifts, payrollEntries, applications, applicationEvents };
}

function exportRepo(data, source = 'account') {
  return buildBackup({ ...data, source });
}

async function makePlan(repo, parsed, options) {
  return planImport(parsed, await readAll(repo), options);
}

function noIds(data) {
  const employmentKeys = new Map(data.employments.map((job) => [
    job.id,
    [job.employer_name.trim().toLowerCase(), job.job_title?.trim().toLowerCase() || '', job.start_date || ''].join('|')
  ]));
  const applicationKeys = new Map(data.applications.map((app) => [
    app.id, [app.company.trim().toLowerCase(), app.position.trim().toLowerCase(), app.date_applied].join('|')
  ]));
  const clean = (rows, link = null) => rows.map((record) => {
    const { id, user_id, updated_at, worked_minutes, ...row } = record;
    if (link === 'employment_id') row.employment_id = row.employment_id == null ? null : employmentKeys.get(row.employment_id);
    if (link === 'application_id') row.application_id = applicationKeys.get(row.application_id);
    return row;
  });
  return {
    profile: Object.fromEntries(['display_name', 'mode', 'currency', 'pay_frequency', 'timezone'].map((key) => [key, data.profile[key]])),
    employments: clean(data.employments),
    shifts: clean(data.shifts, 'employment_id'),
    payrollEntries: clean(data.payrollEntries, 'employment_id'),
    applications: clean(data.applications),
    applicationEvents: clean(data.applicationEvents, 'application_id')
  };
}

test('import remaps relationships and re-importing creates nothing', async () => {
  const source = await createMemory('source-remap');
  const target = await createMemory('target-remap');
  await seedRepo(source, 'Remap');
  await setProfile(target, { mode: 'job_seeker', onboarded: true });
  const backup = exportRepo(await readAll(source));
  const parsed = parseBackup(JSON.stringify(backup));
  const first = await runImport(target, await makePlan(target, parsed));
  assert.deepEqual(first.failures, []);
  assert.deepEqual(first.created, {
    employments: 1, shifts: 1, payrollEntries: 1, applications: 1, applicationEvents: 1
  });
  const imported = await readAll(target);
  assert.notEqual(imported.employments[0].id, backup.employments[0].id);
  assert.notEqual(imported.applications[0].id, backup.applications[0].id);
  assert.equal(imported.shifts[0].employment_id, imported.employments[0].id);
  assert.equal(imported.payrollEntries[0].employment_id, imported.employments[0].id);
  assert.equal(imported.applicationEvents[0].application_id, imported.applications[0].id);

  const second = await runImport(target, await makePlan(target, parsed));
  assert.deepEqual(second.created, {
    employments: 0, shifts: 0, payrollEntries: 0, applications: 0, applicationEvents: 0
  });
  assert.deepEqual(second.skipped, {
    employments: 1, shifts: 1, payrollEntries: 1, applications: 1, applicationEvents: 1
  });
  assert.equal((await readAll(target)).shifts.length, 1);
});

test('duplicate parents map new children to existing employment and application ids', async () => {
  const source = await createMemory('source-parent');
  const target = await createMemory('target-parent');
  await seedRepo(source, 'Same');
  const sourceData = await readAll(source);
  const existingJob = await target.employments.create({
    employer_name: ' Same CO ', job_title: ' analyst ', hourly_rate: 40, start_date: '2025-01-01'
  });
  const existingApp = await target.applications.create({
    company: ' Same Hiring ', position: 'designer', date_applied: '2025-03-01', status: 'pending'
  });
  const incoming = exportRepo(sourceData);
  incoming.shifts[0].work_date = '2025-04-04';
  incoming.payrollEntries[0].pay_date = '2025-04-15';
  incoming.payrollEntries[0].period_start = '2025-04-01';
  incoming.payrollEntries[0].period_end = '2025-04-14';
  incoming.applicationEvents[0].event_date = '2025-04-05T10:30:00.000Z';
  const plan = await makePlan(target, parseBackup(JSON.stringify(incoming)));
  assert.equal(plan.lists.employments.duplicates, 1);
  assert.equal(plan.lists.applications.duplicates, 1);
  await runImport(target, plan);
  const after = await readAll(target);
  assert.equal(after.shifts.find((shift) => shift.work_date === '2025-04-04').employment_id, existingJob.id);
  assert.equal(after.payrollEntries.find((entry) => entry.pay_date === '2025-04-15').employment_id, existingJob.id);
  assert.equal(after.applicationEvents.find((event) => event.event_date.startsWith('2025-04-05')).application_id, existingApp.id);
});

test('dry-run leaves existing records unchanged, profile settings are opt-in, currency difference warns', async () => {
  const source = await createMemory('source-settings');
  const target = await createMemory('target-settings');
  await seedRepo(source, 'Settings');
  await seedRepo(target, 'Existing');
  await setProfile(target, { display_name: 'Target', mode: 'job_seeker', currency: 'EUR', onboarded: true });
  const before = await readAll(target);
  const parsed = parseBackup(JSON.stringify(exportRepo(await readAll(source))));
  const defaultPlan = await makePlan(target, parsed);
  assert.equal(defaultPlan.profileUpdate, null);
  assert.equal(defaultPlan.warnings.some((warning) => /not converted/i.test(warning)), true);
  assert.equal((await readAll(target)).employments.length, before.employments.length);
  await runImport(target, defaultPlan);
  let after = await readAll(target);
  assert.equal(after.profile.currency, 'EUR');
  assert.equal(after.profile.mode, 'job_seeker');
  assert.equal(after.profile.display_name, 'Target');
  for (const list of ['employments', 'shifts', 'payrollEntries', 'applications', 'applicationEvents']) {
    for (const row of before[list]) {
      assert.deepEqual(after[list].find((current) => current.id === row.id), row);
    }
  }

  const requestedPlan = await makePlan(target, parsed, { applyProfileSettings: true });
  assert.deepEqual(requestedPlan.profileUpdate, { currency: 'USD', pay_frequency: 'weekly', timezone: 'UTC' });
  await runImport(target, requestedPlan);
  after = await readAll(target);
  assert.equal(after.profile.currency, 'USD');
  assert.equal(after.profile.mode, 'job_seeker');
});

test('natural duplicates inside a file are skipped even when existing-record skipping is off', async () => {
  const source = await createMemory('source-file-duplicates');
  const target = await createMemory('target-file-duplicates');
  await seedRepo(source, 'Repeat');
  const backup = exportRepo(await readAll(source));
  backup.employments.push({ ...backup.employments[0], id: crypto.randomUUID(), employer_name: ' repeat CO ' });
  backup.applications.push({ ...backup.applications[0], id: crypto.randomUUID(), company: 'REPEAT HIRING ' });
  const plan = await makePlan(target, parseBackup(JSON.stringify(backup)), { skipDuplicates: false });
  assert.equal(plan.lists.employments.duplicates, 1);
  assert.equal(plan.lists.applications.duplicates, 1);
  assert.equal(plan.lists.employments.toCreate.length, 1);
  assert.equal(plan.lists.applications.toCreate.length, 1);
  await runImport(target, plan);
  assert.equal((await readAll(target)).employments.length, 1);
  assert.equal((await readAll(target)).applications.length, 1);
});

test('write failure stops with an exact created/pending report and retry skips prior rows', async () => {
  const source = await createMemory('source-failure');
  const target = await createMemory('target-failure');
  await seedRepo(source, 'Failure');
  const parsed = parseBackup(JSON.stringify(exportRepo(await readAll(source))));
  const plan = await makePlan(target, parsed);
  let writes = 0;
  const failingRepo = { ...target };
  for (const list of ['employments', 'applications', 'shifts', 'payrollEntries', 'applicationEvents']) {
    failingRepo[list] = { ...target[list] };
    const original = target[list].create;
    failingRepo[list].create = async (input) => {
      writes += 1;
      if (writes === 3) throw new Error('Injected failure.');
      return original(input);
    };
  }
  const partial = await runImport(failingRepo, plan);
  assert.equal(partial.failures[0].list, 'shifts');
  assert.equal(partial.created.employments, 1);
  assert.equal(partial.created.applications, 1);
  assert.equal(partial.created.shifts, 0);
  assert.equal(partial.notCreated.shifts.length, 1);
  assert.equal(partial.notCreated.payrollEntries.length, 1);
  assert.equal(partial.warnings.some((warning) => /safe to run this backup again/i.test(warning)), true);
  const retry = await runImport(target, await makePlan(target, parsed));
  assert.deepEqual(retry.failures, []);
  assert.equal(retry.created.employments, 0);
  assert.equal(retry.created.applications, 0);
  assert.equal(retry.created.shifts, 1);
  assert.equal((await readAll(target)).applicationEvents.length, 1);
});

test('memory backup imports into another memory user with the same data except IDs', async () => {
  const source = await createMemory('source-memory-roundtrip');
  const target = await createMemory('target-memory-roundtrip');
  await seedRepo(source, 'Roundtrip');
  await setProfile(target, { mode: 'job_seeker', onboarded: false });
  const sourceData = await readAll(source);
  const parsed = parseBackup(JSON.stringify(exportRepo(sourceData)));
  await runImport(target, await makePlan(target, parsed));
  const targetData = await readAll(target);
  const expected = noIds(sourceData);
  expected.profile.mode = targetData.profile.mode;
  expected.profile.display_name = targetData.profile.display_name;
  assert.deepEqual(noIds(targetData), expected);
});

test('memory and IndexedDB work as both backup sources and import targets', async () => {
  const suffix = crypto.randomUUID();
  const memory = await createMemory('source-cross-' + suffix);
  const local = await createLocal('workpath-transfer-source-' + suffix);
  const localTarget = await createLocal('workpath-transfer-target-' + suffix);
  const memoryTarget = await createMemory('target-cross-' + suffix);
  try {
    await seedRepo(memory, 'Cross');
    const memoryData = await readAll(memory);
    const memoryBackup = parseBackup(JSON.stringify(exportRepo(memoryData)));
    await runImport(localTarget, await makePlan(localTarget, memoryBackup));
    const localExpected = noIds(memoryData);
    const localProfile = await localTarget.profile.get();
    localExpected.profile.mode = localProfile.mode;
    localExpected.profile.display_name = localProfile.display_name;
    assert.deepEqual(noIds(await readAll(localTarget)), localExpected);

    await seedRepo(local, 'Device');
    const localData = await readAll(local);
    const localBackup = parseBackup(JSON.stringify(exportRepo(localData, 'local')));
    await runImport(memoryTarget, await makePlan(memoryTarget, localBackup));
    const memoryExpected = noIds(localData);
    const memoryProfile = await memoryTarget.profile.get();
    memoryExpected.profile.mode = memoryProfile.mode;
    memoryExpected.profile.display_name = memoryProfile.display_name;
    assert.deepEqual(noIds(await readAll(memoryTarget)), memoryExpected);
  } finally {
    for (const repo of [local, localTarget]) {
      repo.close();
      await repo.deleteDatabase().catch(() => {});
    }
  }
});

test('data index returns a read-only view of the existing local database', async () => {
  await deleteLocalDatabase().catch(() => {});
  const setup = createIndexedDbRepo({ getUserId: () => null });
  const userId = await setup.getOrCreateLocalUserId();
  const local = createIndexedDbRepo({ getUserId: () => userId });
  await local.profile.get();
  await local.employments.create({ employer_name: 'Device only' });
  setup.close();
  local.close();

  const readOnly = await getReadOnlyLocalRepo();
  assert.ok(readOnly);
  assert.equal((await readOnly.employments.list()).length, 1);
  assert.equal(readOnly.employments.create, undefined);
  assert.equal(readOnly.shifts.remove, undefined);
  readOnly.close();
  await deleteLocalDatabase();
});
