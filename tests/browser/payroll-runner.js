import { createFakeSupabaseClient, createFakeSupabaseStore, seedFakeProfile } from '../support/fake-supabase-client.js';
import { createSupabaseRepo } from '../../src/js/data/supabase-repo.js';
import { createIndexedDbRepo, deleteIndexedDbDatabase } from '../../src/js/data/indexeddb-repo.js';
import { renderPayrollPage } from '../../src/js/employed/payroll.js';
import { renderJobsPage } from '../../src/js/employed/jobs.js';
import { renderDashboard } from '../../src/js/shared/dashboard.js';
import { renderSettingsPage } from '../../src/js/shared/settings.js';
import { renderEmployedNavigation } from '../../src/js/employed/navigation.js';
import { renderJobSeekerNavigation } from '../../src/js/job-seeker/navigation.js';

const USER_ID = '00000000-0000-4000-8000-000000000071';
const TESTS = [
  ['1. Empty Pay screen', testEmptyState],
  ['2. Add, edit, and delete full and minimal paydays', testPayrollCrud],
  ['3. Payroll form validation', testValidation],
  ['4. Normal and overnight estimates', testRatedShiftEstimate],
  ['5. Unrated shift note', testUnratedShift],
  ['6. Matches, below, and above comparison pills', testComparisonPills],
  ['7. Delete job and preserve unlinked payday', testDeleteEmployment],
  ['8. Settings pay frequency updates current period', testPayFrequencyChange],
  ['9. Job Seeker nav hides Pay and mode switch preserves data', testModeSwitch],
  ['10. Upgrade version 1 local fixture without data loss', testVersionOneUpgrade]
];

const results = document.querySelector('#test-results');
const summary = document.querySelector('#test-summary');
const app = document.querySelector('#test-app');
const counts = { passed: 0, failed: 0 };

for (const [label, test] of TESTS) {
  for (const mode of ['local', 'account']) {
    await runOne(label, mode, test);
  }
}

summary.textContent = `${counts.passed} passed, ${counts.failed} failed across local and account-mode adapters.`;
document.title = `${counts.failed ? 'FAIL' : 'PASS'} — Workpath browser regression checks`;

async function runOne(label, mode, test) {
  let context;
  try {
    context = await makeContext(mode, label, label.startsWith('8.') ? 'weekly' : 'monthly');
    await test(context, mode);
    appendResult('PASS', mode, label);
  } catch (error) {
    counts.failed += 1;
    appendResult('FAIL', mode, `${label}: ${error?.message || error}`);
  } finally {
    app.replaceChildren();
    try { await context?.repo?.deleteDatabase?.(); } catch { /* the fixture is isolated and disposable */ }
  }
}

async function makeContext(mode, label, payFrequency) {
  const userId = crypto.randomUUID();
  let repo;
  let accountStore = null;
  if (mode === 'local') {
    repo = createIndexedDbRepo({
      getUserId: () => userId,
      databaseName: `workpath-browser-${crypto.randomUUID()}`
    });
  } else {
    accountStore = createFakeSupabaseStore();
    seedFakeProfile(accountStore, userId);
    const client = createFakeSupabaseClient({ store: accountStore, userId });
    repo = createSupabaseRepo({ getUserId: () => userId, client });
  }

  await repo.profile.get();
  const profile = await repo.profile.update({
    display_name: 'Payroll test',
    mode: 'employed',
    currency: 'USD',
    pay_frequency: payFrequency,
    timezone: 'UTC',
    onboarded: true
  });
  return { mode, label, repo, profile, accountStore };
}

async function testEmptyState(context) {
  const page = await mountPayroll(context);
  expect(page.querySelector('.empty-state')?.textContent.includes('No paydays yet'), 'Pay screen should show its empty state.');
  expect(page.querySelector('nav[aria-label="Employed navigation"] a[href="#/employed/pay"]')?.getAttribute('aria-current') === 'page',
    'Pay should be the active employed navigation item.');
}

async function testPayrollCrud(context) {
  const job = await context.repo.employments.create({ employer_name: 'Regression Co', job_title: 'Analyst', hourly_rate: 30 });
  let page = await mountPayroll(context);
  await openPayForm(page);
  await submitPayForm({
    pay_date: '2026-10-10', employment_id: job.id, period_start: '2026-10-01', period_end: '2026-10-15',
    gross: '1200.50', deductions: '200.25', net: '1000.25', notes: 'Full entry'
  });
  let entries = await context.repo.payrollEntries.list();
  expect(entries.length === 1 && entries[0].gross === 1200.5 && entries[0].deductions === 200.25,
    'Full payday fields should be saved as numeric money values.');
  const fullId = entries[0].id;

  page = app.querySelector('.payroll-page');
  await openPayForm(page);
  await submitPayForm({ pay_date: '2026-10-11', employment_id: '', net: '40.50' });
  entries = await context.repo.payrollEntries.list();
  const minimal = entries.find((entry) => entry.pay_date === '2026-10-11');
  expect(minimal && minimal.gross === null && minimal.deductions === 0 && minimal.employment_id === null,
    'Pay-date-and-net-only entry should use the documented defaults.');

  page = app.querySelector('.payroll-page');
  const minimalCard = await waitFor(() => [...page.querySelectorAll('.payroll-entry-card')]
    .find((card) => card.textContent.includes('No employer')
      && [...card.querySelectorAll('button')].some((button) => !button.disabled)));
  minimalCard.querySelector('button').click();
  const editForm = await waitFor(() => page.querySelector('.payroll-page form'));
  editForm.elements.net.value = '41.75';
  dispatchSubmit(editForm);
  await waitFor(async () => (await context.repo.payrollEntries.list()).find((entry) => entry.id === minimal.id)?.net === 41.75);
  await waitFor(() => {
    const currentPage = app.querySelector('.payroll-page');
    const updatedCard = [...currentPage.querySelectorAll('.payroll-entry-card')]
      .some((card) => card.textContent.includes('41.75'));
    const buttonsReady = [...currentPage.querySelectorAll('.payroll-entry-card button')]
      .every((button) => !button.disabled);
    return updatedCard && buttonsReady;
  });

  page = app.querySelector('.payroll-page');
  const fullCard = [...page.querySelectorAll('.payroll-entry-card')].find((card) => card.textContent.includes('Full entry'));
  expect(fullCard, 'The full payday should remain available after editing the minimal payday.');
  fullCard.querySelectorAll('button')[1].click();
  const confirmDelete = await waitFor(() => [...fullCard.querySelectorAll('button')].find((button) => button.textContent === 'Delete payday'));
  confirmDelete.click();
  await waitFor(async () => !(await context.repo.payrollEntries.list()).some((entry) => entry.id === fullId));
  expect((await context.repo.payrollEntries.list()).length === 1, 'Delete confirmation should remove only the selected payday.');
}

async function testValidation(context) {
  const page = await mountPayroll(context);
  await openPayForm(page);
  const form = page.querySelector('.payroll-page form');

  setFormValues(form, { pay_date: '2026-10-10', period_start: '2026-10-12', period_end: '2026-10-11', net: '10' });
  dispatchSubmit(form);
  expect((await waitFor(() => form.querySelector('[role="alert"]')?.textContent)) === 'Check the pay period dates.',
    'Reversed pay periods should show a validation error.');

  setFormValues(form, { period_start: '', period_end: '', net: '-1' });
  dispatchSubmit(form);
  expect((await waitFor(() => form.querySelector('[role="alert"]')?.textContent)) === 'Enter a valid net amount of zero or more.',
    'Negative net should show a validation error.');

  setFormValues(form, { pay_date: '', net: '10' });
  dispatchSubmit(form);
  expect((await waitFor(() => form.querySelector('[role="alert"]')?.textContent)) === 'Enter a valid pay date.',
    'Missing pay date should show a validation error.');
}

async function testRatedShiftEstimate(context) {
  const job = await context.repo.employments.create({ employer_name: 'Rated Co', hourly_rate: 20 });
  const normal = await context.repo.shifts.create({
    employment_id: job.id, work_date: '2026-10-05', day_type: 'duty',
    time_in: '2026-10-05T09:00:00Z', time_out: '2026-10-05T17:30:00Z', break_minutes: 30
  });
  const overnight = await context.repo.shifts.create({
    employment_id: job.id, work_date: '2026-10-06', day_type: 'duty',
    time_in: '2026-10-06T22:00:00Z', time_out: '2026-10-07T06:00:00Z', break_minutes: 60
  });
  expect(normal.worked_minutes === 480 && overnight.worked_minutes === 420, 'Normal and overnight worked minutes should match the data layer.');
  const page = await mountPayroll(context);
  const tiles = [...page.querySelectorAll('.payroll-summary .summary-item')].map((tile) => tile.textContent);
  expect(tiles.some((tile) => tile.includes('Estimated pay') && tile.includes('300.00')), 'Estimated pay should total $300.00.');
  expect(tiles.some((tile) => tile.includes('Hours in period') && tile.includes('15h 0m')), 'Summary hours should total 15h 0m.');
}

async function testUnratedShift(context) {
  const job = await context.repo.employments.create({ employer_name: 'Unrated Co', hourly_rate: null });
  await context.repo.shifts.create({
    employment_id: job.id, work_date: '2026-10-08', day_type: 'duty',
    time_in: '2026-10-08T09:00:00Z', time_out: '2026-10-08T11:00:00Z'
  });
  const page = await mountPayroll(context);
  expect(page.querySelector('.payroll-estimate-note')?.textContent.includes('1 unrated shift is excluded.'),
    'Estimate note should report the unrated shift count.');
}

async function testComparisonPills(context) {
  const job = await context.repo.employments.create({ employer_name: 'Verdict Co', hourly_rate: 20 });
  const secondJob = await context.repo.employments.create({ employer_name: 'Second Verdict Co', hourly_rate: 30 });
  await context.repo.shifts.create({
    employment_id: job.id, work_date: '2026-10-09', day_type: 'duty',
    time_in: '2026-10-09T09:00:00Z', time_out: '2026-10-09T10:00:00Z'
  });
  await context.repo.shifts.create({
    employment_id: secondJob.id, work_date: '2026-10-09', day_type: 'duty',
    time_in: '2026-10-09T11:00:00Z', time_out: '2026-10-09T12:00:00Z'
  });
  const period = { period_start: '2026-10-01', period_end: '2026-10-31' };
  await context.repo.payrollEntries.create({ ...period, employment_id: job.id, pay_date: '2026-10-10', gross: 20, net: 20 });
  await context.repo.payrollEntries.create({ ...period, employment_id: job.id, pay_date: '2026-10-11', gross: 19.79, net: 19.79 });
  await context.repo.payrollEntries.create({ ...period, employment_id: job.id, pay_date: '2026-10-12', gross: 20.21, net: 20.21 });
  await context.repo.payrollEntries.create({
    ...period, employment_id: job.id, pay_date: '2026-10-13', gross: 20, net: 20, notes: 'Linked employer estimate'
  });
  await context.repo.payrollEntries.create({
    ...period, pay_date: '2026-10-14', gross: 20, net: 20, notes: 'All jobs estimate'
  });
  const page = await mountPayroll(context);
  const cards = [...page.querySelectorAll('.payroll-entry-card')].map((card) => card.textContent);
  expect(cards.some((text) => text.includes('Matches estimate')), 'Gross within one percent should match.');
  expect(cards.some((text) => text.includes('below estimate')), 'Lower gross should show a below-estimate pill.');
  expect(cards.some((text) => text.includes('above estimate')), 'Higher gross should show an above-estimate pill.');
  expect(cards.some((text) => text.includes('Linked employer estimate') && text.includes('Matches estimate')),
    'A linked payday should compare against shifts for only its employer.');
  expect(cards.some((text) => text.includes('All jobs estimate') && text.includes('Gross is $30.00 below estimate')),
    'An unlinked payday should compare against shifts for all employers.');
}

async function testDeleteEmployment(context) {
  const job = await context.repo.employments.create({ employer_name: 'Delete Co', hourly_rate: 20 });
  const entry = await context.repo.payrollEntries.create({ employment_id: job.id, pay_date: '2026-10-10', net: 100 });
  app.replaceChildren(renderJobsPage({ repo: context.repo, profile: context.profile }));
  const card = await waitFor(() => app.querySelector('.record-card'));
  card.querySelector('button:last-of-type').click();
  expect(card.textContent.includes('paydays will stay but lose their employer link.'), 'Job confirmation should explain linked paydays remain.');
  const confirm = [...card.querySelectorAll('button')].find((button) => button.textContent === 'Delete job');
  expect(Boolean(confirm), 'Job delete confirmation button should be shown.');
  confirm.click();
  await waitFor(async () => (await context.repo.employments.list()).length === 0);
  const saved = (await context.repo.payrollEntries.list()).find((row) => row.id === entry.id);
  expect(saved && saved.employment_id === null, 'Payday should remain with no employer after job deletion.');
  const payPage = await mountPayroll(context);
  expect([...payPage.querySelectorAll('.payroll-entry-card')][0]?.textContent.includes('No employer'), 'Pay card should show no employer.');
}

async function testPayFrequencyChange(context) {
  const page = await mountPayroll(context);
  const before = page.querySelector('.payroll-summary .summary-item')?.textContent;
  const settings = renderSettingsPage(context.profile, {
    storageMode: context.mode,
    storageProtected: true,
    repo: context.repo,
    onSaveSettings: async (values) => { context.profile = await context.repo.profile.update(values); },
    onLogout: async () => {},
    onSwitchToAccount: () => {},
    onDeleteLocalData: async () => {}
  });
  app.replaceChildren(settings);
  const form = settings.querySelector('form');
  form.elements.pay_frequency.value = 'monthly';
  form.elements.pay_frequency.dispatchEvent(new Event('change', { bubbles: true }));
  dispatchSubmit(form);
  expect(await waitFor(() => form.querySelector('[role="status"]')?.textContent) === 'Settings saved.', 'Settings should confirm save.');
  const updated = await mountPayroll(context);
  const after = updated.querySelector('.payroll-summary .summary-item')?.textContent;
  expect(before !== after && after.includes('Oct'), 'New pay frequency should update the current period label.');
}

async function testModeSwitch(context) {
  const job = await context.repo.employments.create({ employer_name: 'Mode Co' });
  await context.repo.payrollEntries.create({ employment_id: job.id, pay_date: '2026-10-10', net: 75 });
  let dashboard;
  dashboard = renderDashboard(context.profile, {
    onModeChange: async (mode) => {
      context.profile = await context.repo.profile.update({ mode });
      dashboard.updateMode(context.profile);
    },
    onOpenSettings: () => {},
    loadEmploymentSummary: async () => ({ workedMinutes: 0, overtimeCount: 0, daysWorked: 0 }),
    loadApplicationSummary: async () => ({ all: 0, interview: 0, offer: 0 })
  });
  app.replaceChildren(dashboard.element);
  expect(Boolean(app.querySelector('nav[aria-label="Employed navigation"] a[href="#/employed/pay"]')), 'Employed mode should show Pay.');
  const seeker = app.querySelector('input[name="mode"][value="job_seeker"]');
  seeker.checked = true;
  seeker.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => context.profile.mode === 'job_seeker' && app.querySelector('nav[aria-label="Job seeker navigation"]'));
  expect(![...app.querySelectorAll('nav a')].some((link) => link.textContent.includes('Pay')), 'Job Seeker navigation must not show Pay.');
  expect((await context.repo.payrollEntries.list()).length === 1, 'Switching to Job Seeker must preserve payroll data.');
  const employed = app.querySelector('input[name="mode"][value="employed"]');
  employed.checked = true;
  employed.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => context.profile.mode === 'employed' && app.querySelector('nav[aria-label="Employed navigation"]'));
  expect((await context.repo.payrollEntries.list()).length === 1, 'Switching back must preserve payroll data.');
}

async function testVersionOneUpgrade(context, mode) {
  const databaseName = `workpath-v1-browser-${crypto.randomUUID()}`;
  const localUserId = crypto.randomUUID();
  await createVersionOneDatabase(databaseName, localUserId);
  let legacyRepo;
  try {
    legacyRepo = createIndexedDbRepo({ getUserId: () => localUserId, databaseName });
    const profile = await legacyRepo.profile.get();
    const jobs = await legacyRepo.employments.list();
    const paydays = await legacyRepo.payrollEntries.list();
    expect(profile.display_name === 'Before upgrade', 'Version 1 profile must survive upgrade.');
    expect(jobs[0]?.employer_name === 'Old job', 'Version 1 job must survive upgrade.');
    expect(paydays.length === 0, 'New payroll store should begin empty.');
    const upgraded = await openDatabase(databaseName);
    expect(upgraded.version === 2 && upgraded.objectStoreNames.contains('payroll_entries'), 'Database should upgrade to version 2.');
    expect(upgraded.transaction('payroll_entries').objectStore('payroll_entries').indexNames.contains('user_id_pay_date'),
      'Payroll composite index should exist after upgrade.');
    upgraded.close();
    if (mode === 'account') {
      await context.repo.payrollEntries.create({ pay_date: '2026-10-10', net: 55 });
      expect((await context.repo.payrollEntries.list()).length === 1, 'Upgrading a separate local fixture must not affect account data.');
    }
  } finally {
    await legacyRepo?.deleteDatabase?.();
    if (!legacyRepo) await deleteIndexedDbDatabase(databaseName);
  }
}

async function mountPayroll(context) {
  app.replaceChildren(renderPayrollPage({ repo: context.repo, profile: context.profile }));
  return await waitFor(() => {
    const page = app.querySelector('.payroll-page');
    return page && page.querySelector('.payroll-summary')?.getAttribute('aria-busy') === 'false' ? page : null;
  });
}

async function openPayForm(page) {
  const button = page.querySelector('button[aria-label="Add a payday"]');
  expect(button && !button.disabled, 'Add payday should be enabled.');
  button.click();
  await waitFor(() => page.querySelector('form'));
}

async function submitPayForm(values) {
  const form = app.querySelector('.payroll-page form');
  setFormValues(form, values);
  dispatchSubmit(form);
  await waitFor(() => !app.querySelector('.payroll-page form'));
}

function setFormValues(form, values) {
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements.namedItem(name);
    expect(Boolean(field), `Missing form field: ${name}`);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function dispatchSubmit(form) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function appendResult(status, mode, message) {
  if (status === 'PASS') counts.passed += 1;
  const item = document.createElement('li');
  item.dataset.result = status.toLowerCase();
  item.textContent = `${status} | ${mode} | ${message}`;
  results.append(item);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(read, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for expected browser state.');
}

function createVersionOneDatabase(databaseName, userId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('profiles', { keyPath: 'id' }).put({
        id: userId, display_name: 'Before upgrade', mode: 'employed', currency: 'USD',
        pay_frequency: 'weekly', timezone: 'UTC', onboarded: true, created_at: '2025-01-01T00:00:00.000Z'
      });
      const employments = db.createObjectStore('employments', { keyPath: 'id' });
      employments.createIndex('user_id', 'user_id');
      employments.put({ id: 'old-job', user_id: userId, employer_name: 'Old job', is_current: true, hourly_rate: 20 });
      const shifts = db.createObjectStore('shifts', { keyPath: 'id' });
      shifts.createIndex('user_id', 'user_id');
      shifts.createIndex('user_id_work_date', ['user_id', 'work_date']);
      shifts.createIndex('employment_id', 'employment_id');
      const applications = db.createObjectStore('applications', { keyPath: 'id' });
      applications.createIndex('user_id', 'user_id');
      applications.createIndex('user_id_date_applied', ['user_id', 'date_applied']);
      applications.createIndex('user_id_status', ['user_id', 'status']);
      const events = db.createObjectStore('applicationEvents', { keyPath: 'id' });
      events.createIndex('user_id', 'user_id');
      events.createIndex('application_id', 'application_id');
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(databaseName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
