import { createFakeSupabaseClient, createFakeSupabaseStore, seedFakeProfile } from '../support/fake-supabase-client.js';
import { createSupabaseRepo } from '../../src/js/data/supabase-repo.js';
import { createIndexedDbRepo } from '../../src/js/data/indexeddb-repo.js';
import { DataError } from '../../src/js/data/errors.js';
import { renderEmployedStatisticsPage, renderJobSeekerStatisticsPage } from '../../src/js/shared/statistics-screen.js';
import { todayInTimeZone } from '../../src/js/shared/time.js';

const TESTS = [
  ['1. Empty statistics screens and mode navigation', testEmptyScreens],
  ['2. Employed range, overnight, overtime, and unrated summaries', testEmployedStats],
  ['3. Job seeker status counts and response-rate threshold', testJobSeekerStats],
  ['4. Account network failure and retry', testAccountNetworkRetry]
];
const app = document.querySelector('#test-app');
const results = document.querySelector('#test-results');
const summary = document.querySelector('#test-summary');
const counts = { passed: 0, failed: 0 };

for (const [label, test] of TESTS) {
  for (const mode of ['local', 'account']) await runOne(label, mode, test);
}

summary.textContent = `${counts.passed} passed, ${counts.failed} failed across local and account-mode adapters.`;
document.title = `${counts.failed ? 'FAIL' : 'PASS'} — Workpath statistics browser checks`;

async function runOne(label, mode, test) {
  let context;
  try {
    context = await makeContext(mode);
    await test(context);
    appendResult('PASS', mode, label);
  } catch (error) {
    counts.failed += 1;
    appendResult('FAIL', mode, `${label}: ${error?.message || error}`);
  } finally {
    app.replaceChildren();
    try { await context?.repo?.deleteDatabase?.(); } catch { /* test database is disposable */ }
  }
}

async function makeContext(mode) {
  const userId = crypto.randomUUID();
  let repo;
  if (mode === 'local') {
    repo = createIndexedDbRepo({ getUserId: () => userId, databaseName: `workpath-stats-${crypto.randomUUID()}` });
  } else {
    const store = createFakeSupabaseStore();
    seedFakeProfile(store, userId);
    repo = createSupabaseRepo({ getUserId: () => userId, client: createFakeSupabaseClient({ store, userId }) });
  }
  await repo.profile.get();
  const profile = await repo.profile.update({
    display_name: 'Stats fixture',
    mode: 'employed',
    currency: 'USD',
    pay_frequency: 'monthly',
    timezone: 'UTC',
    onboarded: true
  });
  return { mode, repo, profile };
}

async function testEmptyScreens(context) {
  let page = await mountEmployed(context, 6, () => {});
  expect(page.querySelector('.stats-empty-state')?.textContent.includes('No work or payday data'), 'Employed empty state should explain what is missing.');
  expect(page.querySelector('nav a[href="#/employed/stats"]')?.getAttribute('aria-current') === 'page', 'Employed Stats should be active in navigation.');

  context.profile = await context.repo.profile.update({ mode: 'job_seeker' });
  page = await mountJobSeeker(context);
  expect(page.querySelector('.stats-empty-state')?.textContent.includes('add an application'), 'Job Seeker empty state should link to applications.');
  expect(page.querySelector('nav a[href="#/seeker/stats"]')?.getAttribute('aria-current') === 'page', 'Job Seeker Stats should be active in navigation.');
  expect(![...page.querySelectorAll('nav a')].some((link) => link.getAttribute('href') === '#/employed/stats'), 'Job Seeker navigation must not show the employed Stats route.');
}

async function testEmployedStats(context) {
  const today = todayInTimeZone('UTC');
  const yesterday = addDays(today, -1);
  const twoDaysAgo = addDays(today, -2);
  const ratedJob = await context.repo.employments.create({ employer_name: '<b>Markup Job</b>', hourly_rate: 20 });
  const noRateJob = await context.repo.employments.create({ employer_name: 'Unrated Job', hourly_rate: null });
  const deletedJob = await context.repo.employments.create({ employer_name: 'Deleted Job', hourly_rate: 25 });
  await context.repo.shifts.create({
    employment_id: ratedJob.id, work_date: today, day_type: 'duty',
    time_in: `${today}T22:00:00.000Z`, time_out: `${addDays(today, 1)}T06:00:00.000Z`, break_minutes: 60
  });
  await context.repo.shifts.create({
    employment_id: ratedJob.id, work_date: yesterday, day_type: 'duty', is_overtime: true,
    time_in: `${yesterday}T09:00:00.000Z`, time_out: `${yesterday}T11:00:00.000Z`, break_minutes: 0
  });
  await context.repo.shifts.create({
    employment_id: noRateJob.id, work_date: today, day_type: 'duty',
    time_in: `${today}T10:00:00.000Z`, time_out: `${today}T11:00:00.000Z`, break_minutes: 0
  });
  await context.repo.shifts.create({
    employment_id: deletedJob.id, work_date: twoDaysAgo, day_type: 'duty',
    time_in: `${twoDaysAgo}T10:00:00.000Z`, time_out: `${twoDaysAgo}T11:00:00.000Z`, break_minutes: 0
  });
  await context.repo.payrollEntries.create({ employment_id: ratedJob.id, pay_date: today, net: 100 });
  await context.repo.employments.remove(deletedJob.id);

  let selectedRange = 6;
  let page = await mountEmployed(context, selectedRange, (value) => { selectedRange = value; });
  expect(tile(page, 'Total worked time').includes('11h 0m'), 'The total should include overnight, overtime, and unrated hours.');
  expect(tile(page, 'Overtime hours').includes('2h 0m'), 'Overtime should include only the user-flagged shift.');
  expect(tile(page, 'Duty days').includes('3'), 'Duty dates should be distinct and use the shift start date.');
  expect(page.querySelector('.stats-chart-note')?.textContent.includes('2 unrated shifts'), 'Unrated hours should be counted in the estimate note.');
  const table = page.querySelector('.stats-job-table');
  expect([...table.querySelectorAll('tbody tr')].some((row) => row.textContent.includes('No employer') && row.textContent.includes('1h 0m')),
    'A deleted job’s shift should be grouped under No employer.');
  expect(table.querySelector('b') === null && [...table.querySelectorAll('tbody th')].some((cell) => cell.textContent.includes('<b>Markup Job</b>')),
    'A job name containing tags should display as plain text.');
  expect(page.querySelector('nav a[href="#/employed/stats"]')?.getAttribute('aria-current') === 'page', 'Employed Stats route should be selected.');

  const range = page.querySelector('select[name="stats_range"]');
  range.value = '3';
  range.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => range.value === '3' && !range.disabled && page.querySelector('.stats-summary[aria-busy="false"]'));
  expect(selectedRange === 3, 'Changing the range should save it in the app state.');
  page = await mountEmployed(context, selectedRange, (value) => { selectedRange = value; });
  expect(page.querySelector('select[name="stats_range"]')?.value === '3', 'Returning to Stats should preserve the selected range.');
}

async function testJobSeekerStats(context) {
  const today = todayInTimeZone('UTC');
  const statuses = ['pending', 'pending', 'interview', 'offer'];
  for (let index = 0; index < statuses.length; index += 1) {
    await context.repo.applications.create({
      company: `Stats Co ${index + 1}`, position: 'Analyst', date_applied: today, status: statuses[index]
    });
  }
  context.profile = await context.repo.profile.update({ mode: 'job_seeker' });
  let page = await mountJobSeeker(context);
  expect(page.querySelector('.stats-response-rate')?.textContent.includes('Not enough data yet'), 'Four applications should not show a response percentage.');
  expect([...page.querySelectorAll('.stats-status-pills .status-badge')].some((pill) => pill.textContent.includes('Interview') && pill.textContent.includes('1')),
    'Status counts should include the interview count.');

  await context.repo.applications.create({ company: 'Stats Co 5', position: 'Analyst', date_applied: today, status: 'no_response' });
  page = await mountJobSeeker(context);
  expect(page.querySelector('.stats-response-rate')?.textContent.includes('60%'), 'Five applications should show the changed-status response rate.');
  expect([...page.querySelectorAll('.stats-status-pills .status-badge')].some((pill) => pill.textContent.includes('No response') && pill.textContent.includes('1')),
    'No response status should have its own count and pill.');
}

async function testAccountNetworkRetry(context) {
  let failNextRead = true;
  const repo = {
    shifts: {
      listBetween: async () => {
        if (failNextRead) {
          failNextRead = false;
          throw new DataError('network', 'We could not reach the database. Check your connection and try again.');
        }
        return [];
      }
    },
    payrollEntries: { listBetween: async () => [] },
    employments: { list: async () => [] }
  };
  app.replaceChildren(renderEmployedStatisticsPage({ repo, profile: context.profile }));

  const failure = await waitFor(() => app.querySelector('.stats-error[role="alert"]'));
  expect(failure.querySelector('.status-message.status-error')?.textContent === 'We could not reach the database. Check your connection and try again.',
    'The network DataError message should be shown in the shared error-banner style.');
  expect(failure.querySelector('button')?.textContent === 'Try again', 'The error state should offer a retry action.');
  expect(!app.querySelector('.stats-summary .summary-item') && !app.querySelector('.stats-content svg'),
    'A failed load must not show zero summary tiles or empty charts as real data.');

  failure.querySelector('button').click();
  await waitFor(() => app.querySelector('.stats-summary[aria-busy="false"]'));
  expect(app.querySelector('.stats-content svg') && !app.querySelector('.stats-error'),
    'Retry should load and render the statistics after connectivity returns.');
}

async function mountEmployed(context, selectedRange, onRangeChange) {
  app.replaceChildren(renderEmployedStatisticsPage({
    repo: context.repo, profile: context.profile, selectedRange, onRangeChange
  }));
  return waitFor(() => {
    const page = app.querySelector('.stats-page');
    return page?.querySelector('.stats-summary[aria-busy="false"]') ? page : null;
  });
}

async function mountJobSeeker(context) {
  app.replaceChildren(renderJobSeekerStatisticsPage({ repo: context.repo, profile: context.profile }));
  return waitFor(() => {
    const page = app.querySelector('.stats-page');
    return page?.querySelector('.stats-summary[aria-busy="false"]') ? page : null;
  });
}

function tile(page, label) {
  const item = [...page.querySelectorAll('.stats-summary .summary-item')]
    .find((candidate) => candidate.querySelector('.summary-label')?.textContent === label);
  return item?.textContent || '';
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
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

async function waitFor(read, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('Timed out waiting for expected statistics screen state.');
}
