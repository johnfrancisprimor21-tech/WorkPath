import { createFakeSupabaseClient, createFakeSupabaseStore, seedFakeProfile } from '../support/fake-supabase-client.js';
import { createSupabaseRepo } from '../../src/js/data/supabase-repo.js';
import { createIndexedDbRepo, deleteIndexedDbDatabase } from '../../src/js/data/indexeddb-repo.js';
import { DataError } from '../../src/js/data/errors.js';
import { renderTransferSection, readAllData } from '../../src/js/transfer/settings-transfer.js';
import { renderSettingsPage } from '../../src/js/shared/settings.js';
import { buildBackup } from '../../src/js/transfer/backup-format.js';
import { todayInTimeZone } from '../../src/js/shared/time.js';

const TESTS = [
  ['1. Export empty and populated backups through the file boundary', testExport],
  ['2. Duplicate preview and cancel leave data unchanged', testDuplicatePreview],
  ['3. Row errors and HTML job names are rendered as text', testErrorPreview],
  ['4. Import valid records and show the completed summary', testImport],
  ['5. Move local data to account and choose keep or typed delete', testMove],
  ['6. Failed account write reports the failure and keeps local copy', testMoveFailure],
  ['7. Real Settings preview refusals, errors, and Cancel', testSettingsImportRegression]
];
const app = document.querySelector('#test-app');
const results = document.querySelector('#test-results');
const summary = document.querySelector('#test-summary');
const counts = { passed: 0, failed: 0 };

for (const [label, test] of TESTS) {
  for (const mode of ['local', 'account']) await runOne(label, mode, test);
}

summary.textContent = counts.passed + ' passed, ' + counts.failed + ' failed across local and account-mode adapters.';
document.title = (counts.failed ? 'FAIL' : 'PASS') + ' — Workpath transfer browser checks';

async function runOne(label, mode, test) {
  let context;
  try {
    context = await makeContext(mode);
    await test(context, mode);
    appendResult('PASS', mode, label);
  } catch (error) {
    counts.failed += 1;
    appendResult('FAIL', mode, label + ': ' + (error?.message || error));
  } finally {
    app.replaceChildren();
    try { await context?.repo?.deleteDatabase?.(); } catch { /* fixtures are disposable */ }
    if (context?.localDatabaseName) {
      try { await deleteIndexedDbDatabase(context.localDatabaseName); } catch { /* fixture is disposable */ }
    }
  }
}

async function makeContext(mode) {
  const userId = crypto.randomUUID();
  let repo;
  if (mode === 'local') {
    const databaseName = 'workpath-transfer-browser-' + crypto.randomUUID();
    repo = createIndexedDbRepo({ getUserId: () => userId, databaseName });
  } else {
    const store = createFakeSupabaseStore();
    seedFakeProfile(store, userId);
    repo = createSupabaseRepo({ getUserId: () => userId, client: createFakeSupabaseClient({ store, userId }) });
  }
  await repo.profile.get();
  const profile = await repo.profile.update({
    display_name: 'Transfer fixture', mode: 'job_seeker', currency: 'USD',
    pay_frequency: 'monthly', timezone: 'UTC', onboarded: true
  });
  const files = makeFileApi();
  return { mode, repo, profile, files, localDatabaseName: null };
}

function makeFileApi() {
  let queued = null;
  const saved = [];
  return {
    saved,
    queue(text, name = 'fixture.json', byteLength = text.length) { queued = { name, text, byteLength }; },
    api: {
      async pickTextFile(options) {
        if (!queued) return null;
        if (queued.byteLength > options.maxBytes) throw new DataError('validation', 'This file is larger than the 10 MB limit. Choose a smaller file.');
        const value = queued;
        queued = null;
        return value;
      },
      async saveTextFile(filename, text, mimeType) {
        saved.push({ filename, text, mimeType });
      }
    }
  };
}

function mount(context, options = {}) {
  app.replaceChildren(renderTransferSection({
    repo: context.repo,
    profile: context.profile,
    storageMode: context.mode,
    fileApi: context.files.api,
    ...options
  }));
  return app.querySelector('.your-data-section');
}

async function testExport(context) {
  let section = mount(context);
  section.querySelector('button').click();
  await waitFor(() => context.files.saved.length === 1);
  const empty = JSON.parse(context.files.saved[0].text);
  expect(context.files.saved[0].filename === 'workpath-backup-' + todayInTimeZone('UTC') + '.json', 'Export filename should use the profile time zone date.');
  expect(empty.employments.length === 0 && empty.shifts.length === 0 && empty.payrollEntries.length === 0
    && empty.applications.length === 0 && empty.applicationEvents.length === 0, 'An empty account should still export a valid empty backup.');
  expect(!JSON.stringify(empty).includes('user_id') && !JSON.stringify(empty).includes('"email"'), 'Export must omit ownership and auth email.');

  await context.repo.employments.create({ employer_name: 'Exported job', job_title: 'Engineer' });
  section.querySelector('button').click();
  await waitFor(() => context.files.saved.length === 2);
  const populated = JSON.parse(context.files.saved[1].text);
  expect(populated.employments.length === 1, 'Export should include the saved job.');
  expect(!JSON.stringify(populated).includes('user_id') && !JSON.stringify(populated).includes('updated_at')
    && !JSON.stringify(populated).includes('worked_minutes'), 'Export must omit database-managed and derived fields.');
  expect(section.textContent.includes('plain text') && section.textContent.includes('private'), 'The private backup note should be visible.');
}

async function testDuplicatePreview(context) {
  await context.repo.employments.create({ employer_name: 'Existing Co', job_title: 'Planner', start_date: '2025-01-01' });
  const backup = buildBackup({
    source: 'account',
    profile: context.profile,
    employments: await context.repo.employments.list(),
    shifts: [], payrollEntries: [], applications: [], applicationEvents: []
  });
  context.files.queue(JSON.stringify(backup));
  const section = mount(context);
  section.querySelector('button:nth-of-type(2)').click();
  await waitFor(() => section.querySelector('.import-preview-panel'));
  expect(section.textContent.includes('Jobs: add 0, skip 1, errors 0'), 'Duplicate preview should show the skipped job.');
  const before = (await context.repo.employments.list()).length;
  section.querySelector('.transfer-preview-actions button:last-child').click();
  expect((await context.repo.employments.list()).length === before, 'Cancelling a preview must write nothing.');
}

async function testErrorPreview(context) {
  const badJobName = '<b>x</b><script>alert(1)</script>';
  const backup = buildBackup({
    source: 'account', profile: context.profile,
    employments: [{ id: crypto.randomUUID(), employer_name: badJobName, job_title: null, hourly_rate: null, start_date: null, end_date: null, is_current: true }],
    shifts: [{
      id: crypto.randomUUID(), employment_id: crypto.randomUUID(), work_date: '2025-02-31', day_type: 'duty',
      time_in: null, time_out: null, break_minutes: 0, is_overtime: false, notes: null
    }],
    payrollEntries: [], applications: [], applicationEvents: []
  });
  context.files.queue(JSON.stringify(backup));
  const section = mount(context);
  section.querySelector('button:nth-of-type(2)').click();
  await waitFor(() => section.querySelector('.import-preview-panel'));
  expect(section.textContent.includes('shifts · row 1'), 'The preview should identify an invalid row number.');
  expect(section.textContent.includes('missing from the backup'), 'The preview should explain a dangling job link.');
  expect([...section.querySelectorAll('.transfer-examples li')].some((row) => row.textContent.includes(badJobName)),
    'HTML-like job names should be shown as literal text.');
  expect(section.querySelector('b, script') === null, 'File contents must not create HTML elements.');
}

async function testImport(context) {
  const backup = sampleBackup(context, 'Added');
  context.files.queue(JSON.stringify(backup));
  const section = mount(context);
  section.querySelector('button:nth-of-type(2)').click();
  await waitFor(() => section.querySelector('.import-preview-panel'));
  section.querySelector('.transfer-preview-actions button:first-child').click();
  await waitFor(() => section.querySelector('.transfer-run-summary'));
  expect(section.textContent.includes('Import complete'), 'A valid import should show a completion summary.');
  const data = await readAllData(context.repo);
  expect(data.employments.length === 1 && data.shifts.length === 1 && data.payrollEntries.length === 1
    && data.applications.length === 1 && data.applicationEvents.length === 1, 'All entity lists should import.');
  expect(data.shifts[0].employment_id === data.employments[0].id, 'Imported shift should point to the newly created job.');
}

async function testMove(context, mode) {
  if (mode !== 'account') {
    const section = mount(context);
    await delay(30);
    expect(!section.textContent.includes('Move to my account'), 'Local mode should not offer a move-to-account action.');
    return;
  }
  const localDatabaseName = 'workpath-transfer-move-' + crypto.randomUUID();
  const localUserId = crypto.randomUUID();
  const localRepo = createIndexedDbRepo({ getUserId: () => localUserId, databaseName: localDatabaseName });
  await localRepo.profile.get();
  await seedData(localRepo, 'Device');
  localRepo.close();
  context.localDatabaseName = localDatabaseName;
  const section = mount(context, {
    getReadOnlyLocalRepo: async () => readOnlyView(createIndexedDbRepo({
      getUserId: () => localUserId, databaseName: localDatabaseName
    })),
    onLocalCopyDeleted: async () => {
      await deleteIndexedDbDatabase(localDatabaseName);
      context.localDeleted = true;
    }
  });
  await waitFor(() => section.querySelector('.local-copy-status button')?.textContent === 'Move to my account');
  expect(section.querySelector('.local-copy-status').textContent.includes('Jobs 1 · Shifts and days off 1'), 'The local-copy notice should show per-list counts.');
  section.querySelector('.local-copy-status button').click();
  await waitFor(() => section.querySelector('.import-preview-panel'));
  expect(section.textContent.includes('Preview move to your account'), 'Move should use the shared import preview.');
  section.querySelector('.transfer-preview-actions button:first-child').click();
  await waitFor(() => section.querySelector('.local-copy-decision'));
  expect(section.querySelector('input[value="keep"]').checked, 'Keeping the local copy should be the default choice.');
  expect(context.repo && (await context.repo.employments.list()).length === 1, 'Move should add local records to the account.');
  expect((await localRepo.employments.list()).length === 1, 'The local copy should remain until deletion is chosen.');
  section.querySelector('input[value="delete"]').click();
  const confirmation = section.querySelector('input[name="delete_confirmation"]');
  confirmation.value = 'DELETE';
  confirmation.dispatchEvent(new Event('input', { bubbles: true }));
  const deleteButton = [...section.querySelectorAll('button')].find((button) => button.textContent === 'Delete data on this device');
  expect(!deleteButton.disabled, 'Typed DELETE should enable local-copy deletion.');
  deleteButton.click();
  await waitFor(() => !section.querySelector('.local-copy-decision form'));
  expect(context.localDeleted, 'The delete choice should remove the local database after confirmation.');
}

async function testMoveFailure(context, mode) {
  if (mode !== 'account') return;
  const localDatabaseName = 'workpath-transfer-failure-' + crypto.randomUUID();
  const localUserId = crypto.randomUUID();
  const localRepo = createIndexedDbRepo({ getUserId: () => localUserId, databaseName: localDatabaseName });
  await localRepo.profile.get();
  await seedData(localRepo, 'Retry');
  localRepo.close();
  context.localDatabaseName = localDatabaseName;
  const originalCreate = context.repo.shifts.create;
  context.repo.shifts.create = async () => {
    throw new DataError('network', 'We could not reach the database. Check your connection and try again.');
  };
  const section = mount(context, {
    getReadOnlyLocalRepo: async () => readOnlyView(createIndexedDbRepo({
      getUserId: () => localUserId, databaseName: localDatabaseName
    }))
  });
  await waitFor(() => section.querySelector('.local-copy-status button')?.textContent === 'Move to my account');
  section.querySelector('.local-copy-status button').click();
  await waitFor(() => section.querySelector('.import-preview-panel'));
  section.querySelector('.transfer-preview-actions button:first-child').click();
  await waitFor(() => section.querySelector('.transfer-run-summary'));
  expect(section.textContent.includes('We could not reach the database'), 'Account write failure should show the DataError network message.');
  expect(section.textContent.includes('safe to run this backup again'), 'Failure should explain that retrying is safe.');
  expect(section.textContent.includes('Shifts and days off: added 0, skipped 0, not added 1'), 'Failure summary should show the pending shift count.');
  expect(section.querySelector('.local-copy-decision') === null, 'Deletion must not be offered after a failed move.');
  context.repo.shifts.create = originalCreate;
}

async function testSettingsImportRegression(context) {
  const settings = mountRealSettings(context);
  const section = settings.querySelector('.your-data-section');
  const importButton = section.querySelector('.transfer-actions button:nth-of-type(2)');

  async function openQueued(text, message) {
    context.files.queue(text);
    importButton.click();
    await waitFor(() => section.querySelector('.import-preview-panel'));
    expect(section.textContent.includes(message), 'Expected refusal or preview message: ' + message);
    return section.querySelector('.import-preview-panel');
  }

  function cancelAndCheck(panel) {
    panel.querySelector('button:last-child').click();
    expect(section.querySelector('.import-preview-panel') === null, 'Cancel should close the preview.');
    expect(section.querySelector('.status-message').hidden, 'Cancel should clear the error banner.');
    expect(section.querySelector('.status-message').textContent === '', 'Cancel should leave no message state behind.');
  }

  let panel = await openQueued(JSON.stringify({ app: 'portfolio', formatVersion: 1 }), 'not a Workpath backup');
  expect(panel.querySelector('.transfer-counts') === null, 'A refused file should not show import counts.');
  expect(![...panel.querySelectorAll('button')].some((button) => button.textContent.includes('Confirm')),
    'A refused file must not show Confirm.');
  cancelAndCheck(panel);

  panel = await openQueued('{not json', 'not valid JSON');
  expect(![...panel.querySelectorAll('button')].some((button) => button.textContent.includes('Confirm')),
    'Malformed JSON must not show Confirm.');
  cancelAndCheck(panel);

  const newer = sampleBackup(context, 'Newer format');
  newer.formatVersion = 2;
  panel = await openQueued(JSON.stringify(newer), 'newer version');
  expect(![...panel.querySelectorAll('button')].some((button) => button.textContent.includes('Confirm')),
    'A newer backup must not show Confirm.');
  cancelAndCheck(panel);

  context.files.queue('too large', 'large.json', 10 * 1024 * 1024 + 1);
  importButton.click();
  await waitFor(() => section.querySelector('.import-preview-panel'));
  panel = section.querySelector('.import-preview-panel');
  expect(panel.textContent.includes('10 MB limit'), 'An oversized file should show the size refusal.');
  expect(![...panel.querySelectorAll('button')].some((button) => button.textContent.includes('Confirm')),
    'An oversized file must not show Confirm.');
  cancelAndCheck(panel);

  const valid = sampleBackup(context, 'Settings valid');
  panel = await openQueued(JSON.stringify(valid), 'Jobs: add 1');
  expect(panel.querySelector('.transfer-preview-actions button:first-child').disabled === false,
    'A valid backup with records to add should enable Confirm.');
  cancelAndCheck(panel);
  expect((await context.repo.employments.list()).length === 0, 'Cancelling a valid preview must write nothing.');

  const rowError = buildBackup({
    source: context.mode,
    profile: context.profile,
    employments: [],
    shifts: [{
      id: crypto.randomUUID(), employment_id: null, work_date: '2025-02-31', day_type: 'duty',
      time_in: null, time_out: null, break_minutes: 0, is_overtime: false, notes: null
    }],
    payrollEntries: [], applications: [], applicationEvents: []
  });
  panel = await openQueued(JSON.stringify(rowError), 'shifts · row 1');
  expect(panel.querySelector('.transfer-preview-actions button:first-child').disabled,
    'A valid file with no valid rows to add should disable Confirm.');
  expect(panel.textContent.includes('There are no valid records to add'), 'The preview should explain why Confirm is disabled.');
  cancelAndCheck(panel);

  await context.repo.employments.create({ employer_name: 'Duplicate Co', job_title: 'Planner', start_date: '2025-01-01' });
  const duplicate = buildBackup({
    source: context.mode,
    profile: context.profile,
    employments: [{
      id: crypto.randomUUID(), employer_name: 'Duplicate Co', job_title: 'Planner', hourly_rate: null,
      start_date: '2025-01-01', end_date: null, is_current: true
    }],
    shifts: [], payrollEntries: [], applications: [], applicationEvents: []
  });
  panel = await openQueued(JSON.stringify(duplicate), 'Jobs: add 0, skip 1, errors 0');
  expect(panel.querySelector('.transfer-preview-actions button:first-child').disabled,
    'A duplicate-only import should disable Confirm.');
  expect(panel.textContent.includes('every valid record is already present'), 'The preview should explain the duplicate-only result.');
  cancelAndCheck(panel);
}

function mountRealSettings(context) {
  const page = renderSettingsPage(context.profile, {
    storageMode: context.mode,
    storageProtected: true,
    repo: context.repo,
    fileApi: context.files.api,
    onSaveSettings: async () => {},
    onLogout: async () => {},
    onSwitchToAccount: () => {},
    onDeleteLocalData: async () => {}
  });
  app.replaceChildren(page);
  return page;
}

function readOnlyView(repo) {
  return {
    profile: { get: () => repo.profile.get() },
    employments: { list: () => repo.employments.list() },
    shifts: { listBetween: (fromDate, toDate) => repo.shifts.listBetween(fromDate, toDate) },
    payrollEntries: { list: (options) => repo.payrollEntries.list(options) },
    applications: { list: (options) => repo.applications.list(options) },
    applicationEvents: { listForApplication: (id) => repo.applicationEvents.listForApplication(id) },
    close: () => repo.close()
  };
}

function sampleBackup(context, prefix) {
  const jobId = crypto.randomUUID();
  const applicationId = crypto.randomUUID();
  return buildBackup({
    source: context.mode,
    profile: context.profile,
    employments: [{
      id: jobId, employer_name: prefix + ' Co', job_title: 'Engineer', hourly_rate: 20,
      start_date: '2025-01-01', end_date: null, is_current: true
    }],
    shifts: [{
      id: crypto.randomUUID(), employment_id: jobId, work_date: '2025-02-03', day_type: 'duty',
      time_in: '2025-02-03T09:00:00.000Z', time_out: '2025-02-03T17:00:00.000Z',
      break_minutes: 30, is_overtime: false, notes: 'Imported shift'
    }],
    payrollEntries: [{
      id: crypto.randomUUID(), employment_id: jobId, pay_date: '2025-02-14', period_start: '2025-02-01',
      period_end: '2025-02-07', gross: 1000, deductions: 100, net: 900, notes: 'Imported payday'
    }],
    applications: [{
      id: applicationId, company: prefix + ' Hiring', position: 'Analyst', source: null, job_url: null,
      location: null, date_applied: '2025-03-01', status: 'pending', contact_name: null,
      contact_email: null, notes: null
    }],
    applicationEvents: [{
      id: crypto.randomUUID(), application_id: applicationId, event_type: 'note',
      event_date: '2025-03-02T12:00:00.000Z', notes: 'Imported event'
    }]
  });
}

async function seedData(repo, prefix) {
  const job = await repo.employments.create({ employer_name: prefix + ' Co', job_title: 'Tester', start_date: '2025-01-01' });
  await repo.shifts.create({
    employment_id: job.id, work_date: '2025-02-03', day_type: 'duty',
    time_in: '2025-02-03T09:00:00.000Z', time_out: '2025-02-03T17:00:00.000Z', break_minutes: 30
  });
  const application = await repo.applications.create({
    company: prefix + ' Hiring', position: 'QA', date_applied: '2025-03-01'
  });
  await repo.applicationEvents.create({
    application_id: application.id, event_type: 'note', event_date: '2025-03-02T12:00:00.000Z'
  });
}

function appendResult(result, mode, message) {
  if (result === 'PASS') counts.passed += 1;
  const item = document.createElement('li');
  item.dataset.result = result.toLowerCase();
  item.textContent = result + ' | ' + mode + ' | ' + message;
  results.append(item);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(read, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (value) return value;
    await delay(15);
  }
  throw new Error('Timed out waiting for expected transfer state.');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
