import { test, expect } from './fixtures.js';
import {
  checkNoHorizontalOverflow,
  chooseMode,
  completeOnboarding,
  createApplication,
  createJob,
  createShift,
  enterLocalMode,
  ensureMode,
  saveSettings,
  simpleBackup,
  startLocal,
  uploadBackup,
  uploadCsv
} from './app-helpers.js';
import { hasE2ECredentials } from './environment.js';

const ACCOUNT_SKIP = 'Account-mode scenarios skipped; set E2E_ACCOUNT=1 and provide E2E_EMAIL and E2E_PASSWORD in .env.e2e.local to opt in.';

test.describe('Local mode through the real Vite app @local', () => {
  test('auth validation, first-use onboarding, route guards, settings, continue-on-device and mobile shell @phone', async ({ page }) => {
    const externalRequests = await enterLocalMode(page);
    await page.goto('/#/employed/jobs');
    await expect(page).toHaveURL(/#\/login$/);

    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Enter a valid email address.');
    await page.goto('/#/signup');
    await page.getByLabel('Email address').fill('bad-address');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toContainText('Enter a valid email address.');

    await page.getByRole('button', { name: 'Use without an account' }).click();
    await expect(page.getByRole('heading', { name: 'Set up your profile' })).toBeVisible();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByRole('alert')).toContainText('Choose a currency');
    await page.getByLabel('Display name (optional)').fill('Phone Local E2E');
    await chooseMode(page, 'employed');
    await page.getByLabel('Currency').selectOption('PHP');
    await page.getByLabel('Pay frequency').selectOption('weekly');
    await page.getByLabel('Time zone').selectOption('Asia/Manila');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page).toHaveURL(/#\/app$/);
    await expect(page.getByRole('heading', { name: 'Hello, Phone Local E2E' })).toBeVisible();

    await page.goto('/#/onboarding');
    await expect(page).toHaveURL(/#\/app$/);
    await page.goto('/#/settings');
    await expect(page.getByText('On this device', { exact: true })).toBeVisible();
    await page.getByLabel('Currency').selectOption('USD');
    await page.getByLabel('Pay frequency').selectOption('monthly');
    await page.getByLabel('Time zone').selectOption('America/New_York');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.', { exact: true })).toBeVisible();
    await page.getByLabel('Pay frequency').selectOption('monthly');
    const otherTab = await page.context().newPage();
    await otherTab.goto('/#/app');
    await expect(otherTab.getByRole('heading', { name: 'Hello, Phone Local E2E' })).toBeVisible();
    await page.bringToFront();
    await expect(page.getByLabel('Pay frequency')).toHaveValue('monthly');
    await otherTab.close();

    await page.goto('/#/app');
    await chooseMode(page, 'job_seeker', { waitForUpdate: true });
    await expect(page.getByRole('navigation', { name: 'Job seeker navigation' })
      .getByRole('link', { name: 'Applications', exact: true })).toBeVisible();
    await page.goto('/#/employed/pay');
    await expect(page).toHaveURL(/#\/app$/);
    await chooseMode(page, 'employed', { waitForUpdate: true });
    await expect(page.getByRole('link', { name: 'Pay' })).toBeVisible();
    await page.goto('/#/seeker/applications');
    await expect(page).toHaveURL(/#\/app$/);

    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Sign in or create an account' }).click();
    await expect(page).toHaveURL(/#\/login$/);
    await expect(page.getByRole('button', { name: 'Continue on this device' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue on this device' }).click();
    await expect(page).toHaveURL(/#\/app$/);
    await expect(page.getByRole('heading', { name: 'Hello, Phone Local E2E' })).toBeVisible();

    await checkNoHorizontalOverflow(page);
    await expect(page.getByRole('navigation', { name: 'Employed navigation' })).toBeVisible();
    const navItems = await page.getByRole('navigation', { name: 'Employed navigation' }).getByRole('link').count();
    expect(navItems).toBe(5);
    expect(externalRequests).toEqual([]);
  });

  test('jobs, normal and overnight shifts, month navigation and data across mode switches', async ({ page }) => {
    const externalRequests = await startLocal(page, { displayName: 'Employment Local E2E' });
    const prefix = 'E2E-local-employment';
    const jobName = `${prefix} Job`;
    await createJob(page, { name: jobName, title: `${prefix} role`, rate: '100' });

    await page.getByRole('button', { name: 'Edit' }).first().click();
    await page.getByLabel('Job title').fill(`${prefix} edited`);
    await page.getByRole('button', { name: 'Save job' }).click();
    await expect(page.getByText(`${prefix} edited`, { exact: true })).toBeVisible();

    await createShift(page, { date: '2026-10-14', timeIn: '09:00', timeOut: '17:30', breakMinutes: '30', jobName, notes: prefix });
    await expect(page.locator('.worked-time-badge').filter({ hasText: '8h 0m' })).toBeVisible();
    await createShift(page, { date: '2026-10-15', timeIn: '22:00', timeOut: '06:00', breakMinutes: '60', jobName, notes: prefix, overtime: true });
    const overnight = page.locator('.shift-card').first();
    await expect(overnight.getByText('7h 0m', { exact: true })).toBeVisible();
    await expect(overnight.getByText(/next day/)).toBeVisible();
    await expect(overnight.getByText('Overtime', { exact: true })).toBeVisible();
    await expect(page.getByText('Days worked').locator('..')).toContainText('2');

    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByRole('heading', { name: 'September 2026' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No shifts this month' })).toBeVisible();
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.getByRole('heading', { name: 'E2E-local-employment Job', exact: true }).first()).toBeVisible();

    await page.goto('/#/app');
    await chooseMode(page, 'job_seeker', { waitForUpdate: true });
    await expect(page.getByRole('link', { name: 'Applications', exact: true })).toBeVisible();
    await chooseMode(page, 'employed', { waitForUpdate: true });
    await page.goto('/#/employed/jobs');
    await expect(page.getByRole('heading', { name: jobName })).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete job' }).click();
    await expect(page.getByRole('heading', { name: jobName })).toHaveCount(0);
    expect(externalRequests).toEqual([]);
  });

  test.describe('New York DST behavior', () => {
    test.use({ timezoneId: 'America/New_York' });

    test('skipped times are rejected and fall-back uses the first occurrence', async ({ page }) => {
    const externalRequests = await startLocal(page, {
      displayName: 'DST Local E2E', timezone: 'America/New_York'
    });
    await page.goto('/#/employed/shifts');
    await page.getByRole('button', { name: 'Log a shift' }).first().click();
    await page.getByLabel('Work date').fill('2026-03-08');
    await page.getByLabel('Time in').fill('02:30');
    await page.getByLabel('Time out').fill('04:00');
    await page.getByLabel('Notes').fill('E2E-DST-spring');
    await page.getByRole('button', { name: 'Save shift' }).click();
    await expect(page.getByRole('alert')).toContainText('does not exist because the clocks change');

    await page.getByLabel('Work date').fill('2026-11-01');
    await page.getByLabel('Time in').fill('01:30');
    await page.getByLabel('Time out').fill('01:45');
    await page.getByRole('button', { name: 'Save shift' }).click();
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.locator('.worked-time-badge')).toContainText('0h 15m');
    expect(externalRequests).toEqual([]);
    });
  });

  test('paydays validate, estimate by linked job, survive job deletion and follow pay frequency', async ({ page }) => {
    const externalRequests = await startLocal(page, { displayName: 'Payroll Local E2E' });
    const prefix = 'E2E-local-payroll';
    const jobA = `${prefix} Job A`;
    const jobB = `${prefix} Job B`;
    await page.goto('/#/employed/pay');
    await expect(page.getByRole('heading', { name: 'No paydays yet' })).toBeVisible();

    await createJob(page, { name: jobA, title: 'Higher rate', rate: '100' });
    await createJob(page, { name: jobB, title: 'Lower rate', rate: '50' });
    await createShift(page, { date: '2026-10-12', timeIn: '09:00', timeOut: '11:00', breakMinutes: '0', jobName: jobA, notes: prefix });
    await createShift(page, { date: '2026-10-13', timeIn: '09:00', timeOut: '12:00', breakMinutes: '0', jobName: jobB, notes: prefix });
    await page.goto('/#/employed/pay');
    await expect(page.getByText('Estimated pay').locator('..')).toContainText('350');
    await expect(page.getByText('Hours in period').locator('..')).toContainText('5h 0m');

    await page.getByRole('button', { name: 'Add a payday' }).click();
    await page.getByLabel('Pay date').fill('2026-10-16');
    await page.getByLabel('Employer (optional)').selectOption({ label: `${jobA} · Higher rate` });
    await page.getByLabel('Period start (optional)').fill('2026-10-12');
    await page.getByLabel('Period end (optional)').fill('2026-10-18');
    await page.getByLabel('Gross (optional)').fill('200');
    await page.getByLabel('Deductions').fill('20');
    await page.getByLabel('Net').fill('180');
    await page.getByLabel('Notes (optional)').fill(prefix + ' full payday');
    await page.getByRole('button', { name: 'Add payday' }).click();
    const linkedPayday = page.locator('.payroll-entry-card').filter({ hasText: '180' }).first();
    await expect(linkedPayday.getByText('Matches estimate')).toBeVisible();

    await page.getByRole('button', { name: 'Add a payday' }).click();
    await page.getByLabel('Pay date').fill('2026-10-15');
    await page.getByLabel('Employer (optional)').selectOption('');
    await page.getByLabel('Period start (optional)').fill('2026-10-12');
    await page.getByLabel('Period end (optional)').fill('2026-10-18');
    await page.getByLabel('Gross (optional)').fill('100');
    await page.getByLabel('Net').fill('100');
    await page.getByLabel('Notes (optional)').fill(prefix + ' below payday');
    await page.getByRole('button', { name: 'Add payday' }).click();
    await expect(page.getByText(/Gross is .* below estimate/)).toBeVisible();

    await page.getByRole('button', { name: 'Add a payday' }).click();
    await page.getByLabel('Pay date').fill('2026-10-14');
    await page.getByLabel('Employer (optional)').selectOption('');
    await page.getByLabel('Period start (optional)').fill('2026-10-12');
    await page.getByLabel('Period end (optional)').fill('2026-10-18');
    await page.getByLabel('Gross (optional)').fill('400');
    await page.getByLabel('Net').fill('400');
    await page.getByLabel('Notes (optional)').fill(prefix + ' above payday');
    await page.getByRole('button', { name: 'Add payday' }).click();
    await expect(page.getByText(/Gross is .* above estimate/)).toBeVisible();

    await page.getByRole('button', { name: 'Add a payday' }).click();
    await page.getByLabel('Pay date').fill('2026-10-13');
    await page.getByLabel('Gross (optional)').fill('0');
    await page.getByLabel('Net').fill('-1');
    await page.getByLabel('Period start (optional)').fill('2026-10-18');
    await page.getByLabel('Period end (optional)').fill('2026-10-12');
    await page.getByLabel('Notes (optional)').fill(prefix + ' invalid');
    await page.getByRole('button', { name: 'Add payday' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('Net').fill('50');
    await page.getByRole('button', { name: 'Add payday' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('Pay date').fill('');
    await page.getByLabel('Period start (optional)').fill('');
    await page.getByLabel('Period end (optional)').fill('');
    await page.getByRole('button', { name: 'Add payday' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Add a payday' }).click();
    await page.getByLabel('Pay date').fill('2026-10-11');
    await page.getByLabel('Employer (optional)').selectOption('');
    await page.getByLabel('Net').fill('55');
    await page.getByLabel('Notes (optional)').fill(prefix + ' minimal payday');
    await page.getByRole('button', { name: 'Add payday' }).click();
    const minimal = page.locator('.payroll-entry-card').filter({ hasText: prefix + ' minimal payday' });
    await expect(minimal).toBeVisible();
    await expect(minimal.getByText('Matches estimate')).toHaveCount(0);
    await minimal.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Net').fill('56');
    await page.getByRole('button', { name: 'Save payday' }).click();
    await expect(page.getByText(prefix + ' minimal payday')).toBeVisible();
    await minimal.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete payday' }).click();
    await expect(page.getByText(prefix + ' minimal payday')).toHaveCount(0);

    await saveSettings(page, { payFrequency: 'monthly' });
    await page.goto('/#/employed/pay');
    await expect(page.getByText('Current pay period').locator('..')).toContainText('Oct 1, 2026');
    await saveSettings(page, { payFrequency: 'weekly' });
    await page.goto('/#/employed/pay');
    await expect(page.getByText('Current pay period').locator('..')).toContainText('Oct 12');

    await page.goto('/#/employed/jobs');
    const jobCard = page.locator('.record-card').filter({ hasText: jobA });
    await jobCard.getByRole('button', { name: 'Delete' }).click();
    await jobCard.getByRole('button', { name: 'Delete job' }).click();
    await page.goto('/#/employed/pay');
    await expect(page.locator('.payroll-entry-card').first().getByText('No employer', { exact: true })).toBeVisible();
    expect(externalRequests).toEqual([]);
  });

  test('statistics, offline local mode, application CRUD, filters, timeline and response rate', async ({ page }) => {
    const externalRequests = await startLocal(page, { displayName: 'Statistics Local E2E' });
    const prefix = 'E2E-local-stats';
    const htmlName = `${prefix} <b>x</b><script>alert(1)</script>`;
    await createJob(page, { name: htmlName, title: 'HTML role', rate: '80' });
    await createJob(page, { name: `${prefix} No Rate`, title: 'Unrated', rate: null });
    await createShift(page, { date: '2026-10-14', timeIn: '22:00', timeOut: '06:00', breakMinutes: '60', jobName: htmlName, notes: prefix, overtime: true });
    await createShift(page, { date: '2026-09-14', timeIn: '09:00', timeOut: '10:00', breakMinutes: '0', jobName: `${prefix} No Rate`, notes: prefix });
    await page.goto('/#/employed/pay');
    await page.getByRole('button', { name: 'Add a payday' }).click();
    await page.getByLabel('Pay date').fill('2026-10-16');
    await page.getByLabel('Net').fill('60');
    await page.getByLabel('Notes (optional)').fill(prefix + ' payday');
    await page.getByRole('button', { name: 'Add payday' }).click();

    await page.goto('/#/employed/stats');
    await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible();
    await page.getByLabel('Time range').selectOption('3');
    await expect(page.getByText(/unrated shift/)).toBeVisible();
    const earningsTable = page.locator('.stats-section').filter({ has: page.getByRole('heading', { name: 'Earnings by month' }) });
    await expect(earningsTable).toContainText('None');
    const htmlJobRow = page.getByRole('rowheader').filter({ hasText: htmlName });
    await expect(htmlJobRow).toBeVisible();
    await expect(htmlJobRow.locator('b, script')).toHaveCount(0);
    await page.getByRole('link', { name: 'Jobs' }).click();
    await page.getByRole('link', { name: 'Stats' }).click();
    await expect(page.getByLabel('Time range')).toHaveValue('3');

    await ensureMode(page, 'job_seeker');
    await page.goto('/#/seeker/stats');
    await expect(page.getByText('Your application stats will appear after you add an application.')).toBeVisible();
    const statuses = ['pending', 'interview', 'offer', 'rejected'];
    await page.goto('/#/seeker/applications');
    await expect(page.getByRole('heading', { name: 'Add your first application' })).toBeVisible();
    for (let index = 0; index < statuses.length; index += 1) {
      await createApplication(page, {
        company: `${prefix} ${statuses[index]}`,
        status: statuses[index],
        date: `2026-10-${String(10 + index).padStart(2, '0')}`,
        contactEmail: index === 0 ? 'contact@example.test' : undefined,
        jobUrl: index === 0 ? 'https://jobs.example.test/role' : undefined,
        notes: prefix + ' application'
      });
    }
    await page.goto('/#/seeker/stats');
    await expect(page.getByText('Not enough data yet', { exact: true })).toBeVisible();
    await createApplication(page, { company: `${prefix} fifth`, status: 'pending', date: '2026-10-16', notes: prefix });
    await page.goto('/#/seeker/stats');
    await expect(page.getByText('60%', { exact: true })).toBeVisible();

    await page.goto('/#/seeker/applications');
    await page.getByLabel('Search company or position').fill('offer');
    await expect(page.getByRole('heading', { name: `${prefix} offer` })).toBeVisible();
    await page.getByLabel('Search company or position').fill('no-match');
    await expect(page.getByText('No applications match these filters.')).toBeVisible();
    await page.getByLabel('Search company or position').fill('');
    const applicationCard = page.locator('.application-card').filter({ hasText: `${prefix} fifth` });
    await applicationCard.getByLabel('Change status').selectOption('interview');
    await applicationCard.locator('details.application-timeline').locator('summary').click();
    await expect(applicationCard.getByRole('heading', { name: 'Status changed' })).toBeVisible();
    await page.goto('/#/seeker/stats');
    await expect(page.getByText('80%', { exact: true })).toBeVisible();
    await page.goto('/#/seeker/applications');
    const refreshedCard = page.locator('.application-card').filter({ hasText: `${prefix} fifth` });
    await refreshedCard.locator('details.application-timeline').locator('summary').click();
    await expect(refreshedCard.getByRole('heading', { name: 'Status changed' })).toBeVisible();
    await refreshedCard.getByRole('button', { name: 'Add event' }).click();
    await page.getByLabel('Event type').selectOption('follow_up');
    await page.getByLabel('Notes (optional)').last().fill(prefix + ' follow-up');
    await page.getByRole('button', { name: 'Save event' }).click();
    await expect(refreshedCard.getByText(prefix + ' follow-up')).toBeVisible();
    const followUpEvent = refreshedCard.locator('.timeline-event').filter({ hasText: prefix + ' follow-up' });
    await followUpEvent.getByRole('button', { name: 'Delete event' }).first().click();
    await followUpEvent.getByRole('button', { name: 'Delete event' }).last().click();
    await expect(refreshedCard.getByText(prefix + ' follow-up')).toHaveCount(0);
    await refreshedCard.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Position', { exact: true }).fill('Edited title');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(refreshedCard.getByText('Edited title')).toBeVisible();
    await refreshedCard.getByRole('button', { name: 'Delete' }).click();
    await refreshedCard.getByRole('button', { name: 'Delete application' }).click();
    await expect(refreshedCard).toHaveCount(0);

    await ensureMode(page, 'employed');
    await page.goto('/#/employed/stats');
    await page.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== 'http://127.0.0.1:5173') await route.abort();
      else await route.continue();
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible();
    expect(await page.locator('.stats-chart').count()).toBeGreaterThan(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(externalRequests).toEqual([]);
  });

  test('transfer export/import uses the real Settings screen and preserves file privacy', async ({ page, browser }) => {
    const externalRequests = await startLocal(page, { displayName: 'Transfer Local E2E' });
    const prefix = 'E2E-local-transfer';
    await page.goto('/#/settings');

    const emptyDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export backup (JSON)' }).click();
    const emptyDownload = await emptyDownloadPromise;
    const emptyText = await (await import('node:fs/promises')).readFile(await emptyDownload.path(), 'utf8');
    const emptyBackup = JSON.parse(emptyText);
    expect(emptyBackup.app).toBe('workpath');
    expect(JSON.stringify(emptyBackup)).not.toMatch(/user_id|worked_minutes|created_at|updated_at|auth/i);
    expect(JSON.stringify(emptyBackup)).not.toContain('email');

    const htmlJobName = `${prefix} <b>x</b><script>alert(1)</script>`;
    await createJob(page, { name: htmlJobName, title: 'Transfer role', rate: '44' });
    await createShift(page, { date: '2026-10-15', timeIn: '09:00', timeOut: '10:00', breakMinutes: '0', notes: prefix });
    await createApplication(page, {
      company: prefix + ' Company',
      contactEmail: 'contact@example.test',
      notes: prefix,
      jobUrl: 'https://example.test/job'
    });
    await page.goto('/#/settings');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export backup (JSON)' }).click();
    const download = await downloadPromise;
    const backupText = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8');
    const backup = JSON.parse(backupText);
    expect(JSON.stringify(backup)).not.toMatch(/user_id|worked_minutes|created_at|updated_at|auth/i);
    expect(backup.applications[0].contact_email).toBe('contact@example.test');
    expect(backup.employments[0].employer_name).toContain('<script>');

    await uploadBackup(page, 'source.json', backupText);
    await expect(page.getByRole('heading', { name: 'Preview backup import' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm import' })).toBeDisabled();
    await expect(page.getByText(/already present/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Preview backup import' })).toHaveCount(0);

    const wrongApp = JSON.parse(backupText);
    wrongApp.app = 'portfolio';
    await uploadBackup(page, 'wrong-app.json', JSON.stringify(wrongApp));
    await expect(page.locator('.import-preview-panel')).toContainText('This file is not a Workpath backup.');
    await expect(page.getByRole('button', { name: 'Confirm import' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel' }).click();

    await uploadBackup(page, 'not-json.json', '{');
    await expect(page.locator('.import-preview-panel')).toContainText('This file is not valid JSON.');
    await expect(page.getByRole('button', { name: 'Confirm import' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel' }).click();

    const newer = JSON.parse(backupText);
    newer.formatVersion = 2;
    await uploadBackup(page, 'newer.json', JSON.stringify(newer));
    await expect(page.getByRole('alert')).toContainText('newer version');
    await page.getByRole('button', { name: 'Cancel' }).click();

    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 32);
    await uploadBackup(page, 'large.json', oversized);
    await expect(page.getByRole('alert')).toContainText('10 MB limit');
    await expect(page.getByRole('button', { name: 'Confirm import' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel' }).click();

    const badDate = JSON.parse(simpleBackup());
    badDate.employments.push({ id: '10000000-0000-4000-8000-000000000001', employer_name: prefix + ' Bad date', job_title: null, hourly_rate: null, start_date: 'not-a-date', end_date: null, is_current: true });
    badDate.shifts.push({ id: '10000000-0000-4000-8000-000000000002', employment_id: '10000000-0000-4000-8000-000000000099', work_date: 'no-date', day_type: 'duty', time_in: null, time_out: null, break_minutes: 0, is_overtime: false, notes: prefix });
    await uploadBackup(page, 'row-errors.json', JSON.stringify(badDate));
    await expect(page.getByRole('heading', { name: 'Preview backup import' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm import' })).toBeDisabled();
    await expect(page.locator('.transfer-errors-area')).toContainText('employments · row 1');
    await expect(page.locator('.transfer-errors-area')).toContainText('shifts · row 1');
    await page.getByRole('button', { name: 'Cancel' }).click();

    const cancelledPicker = page.getByRole('button', { name: 'Import backup (JSON)' });
    await page.evaluate(() => {
      HTMLInputElement.prototype.click = function click() {
        this.dispatchEvent(new Event('cancel'));
      };
    });
    await cancelledPicker.click();
    await expect(page.getByRole('heading', { name: 'Preview backup import' })).toHaveCount(0);

    const targetContext = await browser.newContext({ timezoneId: 'Asia/Manila', viewport: { width: 1280, height: 900 } });
    try {
      const target = await targetContext.newPage();
      await target.clock.install({ time: new Date('2026-10-16T12:00:00.000Z') });
      await startLocal(target, { displayName: 'Import Target E2E' });
      await target.goto('/#/settings');
      await uploadBackup(target, 'source.json', backupText);
      await expect(target.getByRole('heading', { name: 'Preview backup import' })).toBeVisible();
      await expect(target.getByRole('button', { name: 'Confirm import' })).toBeEnabled();
      await target.getByRole('button', { name: 'Confirm import' }).click();
      await expect(target.getByRole('heading', { name: 'Import complete' })).toBeVisible();
      await expect(target.getByText('Applications: added 1')).toBeVisible();
      await target.getByRole('button', { name: 'Import backup (JSON)' }).click();
      await uploadBackup(target, 'source.json', backupText);
      await expect(target.getByRole('button', { name: 'Confirm import' })).toBeDisabled();
      await expect(target.getByText(/every valid record is already present/)).toBeVisible();
      await target.getByRole('button', { name: 'Cancel' }).click();
      await target.goto('/#/employed/jobs');
      const importedHtmlJob = target.getByRole('heading', { name: htmlJobName, exact: true });
      await expect(importedHtmlJob).toBeVisible();
      await expect(importedHtmlJob.locator('b, script')).toHaveCount(0);
      await target.goto('/#/app');
      await chooseMode(target, 'job_seeker', { waitForUpdate: true });
      await target.goto('/#/seeker/applications');
      await expect(target.getByRole('heading', { name: prefix + ' Company' })).toBeVisible();
    } finally {
      await targetContext.close();
    }
    expect(externalRequests).toEqual([]);
  });

  test('CSV export, header-only template, row error preview, retry and cancel work through Settings', async ({ page }) => {
    const externalRequests = await startLocal(page, { displayName: 'CSV Local E2E' });
    await page.goto('/#/settings');

    const emptyDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Jobs CSV' }).click();
    const emptyDownload = await emptyDownloadPromise;
    const fs = await import('node:fs/promises');
    const emptyCsv = await fs.readFile(await emptyDownload.path(), 'utf8');
    expect(emptyCsv.startsWith('\uFEFF')).toBe(true);
    expect(emptyCsv.replace(/^\uFEFF/, '').trim().split(/\r?\n/)).toHaveLength(1);
    expect(emptyCsv).toContain('employer_name,job_title,hourly_rate,start_date,end_date,is_current');

    await page.locator('.csv-template-help summary').filter({ hasText: 'Jobs' }).click();
    const templatePromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Jobs template' }).click();
    const template = await templatePromise;
    const templateText = await fs.readFile(await template.path(), 'utf8');
    expect(templateText.replace(/^\uFEFF/, '').trim().split(/\r?\n/)).toHaveLength(1);

    const htmlName = 'E2E-CSV <b>safe</b><script>alert(1)</script>';
    const csvText = [
      'employer_name,job_title,hourly_rate,start_date,end_date,is_current,extra_column',
      `"${htmlName}",Analyst,31.25,2026-01-01,,yes,ignored`,
      'E2E-CSV bad row,Analyst,not-money,2026-01-01,,yes,ignored'
    ].join('\r\n');

    await uploadCsv(page, 'jobs.csv', csvText);
    await expect(page.getByRole('heading', { name: 'Preview CSV import' })).toBeVisible();
    await expect(page.locator('.transfer-errors-area')).toContainText('employments · row 3 · column hourly_rate');
    await expect(page.locator('.transfer-warnings')).toContainText('Ignored columns: extra_column');
    const htmlPreview = page.locator('.transfer-examples');
    await expect(htmlPreview).toContainText(htmlName);
    await expect(htmlPreview.locator('b, script')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirm import' })).toBeEnabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Preview CSV import' })).toHaveCount(0);
    await page.goto('/#/employed/jobs');
    await expect(page.getByRole('heading', { name: htmlName, exact: true })).toHaveCount(0);

    await page.goto('/#/settings');
    await uploadCsv(page, 'jobs.csv', csvText);
    await expect(page.getByRole('button', { name: 'Confirm import' })).toBeEnabled();
    await page.getByRole('button', { name: 'Confirm import' }).click();
    await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible();
    await expect(page.locator('.transfer-run-summary')).toContainText('Jobs: added 1');

    await page.getByRole('button', { name: 'Import CSV' }).click();
    await uploadCsv(page, 'jobs-again.csv', csvText);
    await expect(page.locator('.transfer-counts')).toContainText('Jobs: add 0, skip 1, errors 1');
    await expect(page.getByRole('button', { name: 'Confirm import' })).toBeDisabled();
    await expect(page.locator('.import-preview-panel')).toContainText('Nothing to add');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    const exportedPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Jobs CSV' }).click();
    const exported = await exportedPromise;
    const exportedText = await fs.readFile(await exported.path(), 'utf8');
    expect(exportedText).toContain(htmlName);

    await page.evaluate(() => {
      HTMLInputElement.prototype.click = function click() {
        this.dispatchEvent(new Event('cancel'));
      };
    });
    await page.getByRole('button', { name: 'Import CSV' }).click();
    await expect(page.getByRole('heading', { name: 'Preview CSV import' })).toHaveCount(0);
    expect(externalRequests).toEqual([]);
  });

  test('Stats exports print-ready PDF reports for both modes @local', async ({ page }, testInfo) => {
    const externalRequests = await startLocal(page, { displayName: 'PDF Local E2E' });
    await createJob(page, { name: 'E2E-PDF Employer', title: 'Report role', rate: '25' });
    await createShift(page, {
      date: '2026-10-15', timeIn: '22:00', timeOut: '06:00', breakMinutes: '60',
      jobName: 'E2E-PDF Employer'
    });
    await page.goto('/#/employed/stats');
    await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible();
    await page.getByLabel('Time range').selectOption('3');
    const printButton = page.getByRole('button', { name: 'Export PDF' });
    await expect(printButton).toBeEnabled();
    const originalTitle = await page.title();
    await page.evaluate(() => {
      window.print = () => { window.__workpathPrintCalls = (window.__workpathPrintCalls || 0) + 1; };
    });

    const assertPaperFormats = async (mode) => {
      for (const { format, contentWidth } of [
        { format: 'A4', contentWidth: 680 },
        { format: 'Letter', contentWidth: 702 }
      ]) {
        await page.emulateMedia({ media: null });
        await page.setViewportSize({ width: contentWidth, height: 1000 });
        await page.getByRole('button', { name: 'Export PDF' }).click();
        const printRoot = page.locator('#print-root');
        await expect(printRoot).toBeAttached();
        await expect(printRoot).toContainText(mode === 'employed' ? 'Employed Statistics Report' : 'Job Seeker Statistics Report');
        if (mode === 'employed') await expect(printRoot).toContainText('7h 0m');
        else await expect(printRoot).toContainText('No data in this range.');
        expect(await page.title()).toBe(mode === 'employed' ? 'Employed Statistics Report' : 'Job Seeker Statistics Report');
        expect(await page.evaluate(() => window.__workpathPrintCalls)).toBe(mode === 'employed' ? (format === 'A4' ? 1 : 2) : (format === 'A4' ? 3 : 4));

        await page.emulateMedia({ media: 'print' });
        await expect(page.locator('nav').first()).toBeHidden();
        expect(await page.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(255, 255, 255)');
        const layout = await page.evaluate(() => ({
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth,
          root: document.querySelector('#print-root')?.scrollWidth
        }));
        expect(layout.document <= layout.viewport, `${mode} ${format}: ${JSON.stringify(layout)}`).toBe(true);
        expect(layout.root <= layout.viewport, `${mode} ${format}: ${JSON.stringify(layout)}`).toBe(true);

        const pdfPath = testInfo.outputPath(`${mode}-${format.toLowerCase()}.pdf`);
        const pdf = await page.pdf({ path: pdfPath, format });
        expect(pdf.byteLength).toBeGreaterThan(0);
        expect(pdf.toString('latin1')).toMatch(/\/Type\s*\/Page\b/);

        await page.emulateMedia({ media: null });
        await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
        await expect(printRoot).toHaveCount(0);
        expect(await page.title()).toBe(originalTitle);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
    };

    await assertPaperFormats('employed');
    expect(await page.getByLabel('Time range').inputValue()).toBe('3');

    await ensureMode(page, 'job_seeker');
    await page.goto('/#/seeker/stats');
    await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled();
    await assertPaperFormats('job-seeker');
    expect(externalRequests).toEqual([]);
  });

  test('phone layout fits and forms are keyboard reachable @phone', async ({ page }) => {
    const externalRequests = await startLocal(page, { displayName: 'Keyboard Local E2E' });
    await page.goto('/#/employed/jobs');
    await page.getByRole('button', { name: 'Add a job', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Add a job' })).toBeVisible();
    await page.getByLabel('Employer name').fill('E2E-keyboard-job');
    await page.getByLabel('Job title').fill('Keyboard role');
    await page.getByRole('button', { name: 'Add job', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'E2E-keyboard-job' })).toBeVisible();
    await checkNoHorizontalOverflow(page);
    const nav = page.getByRole('navigation', { name: 'Employed navigation' });
    await expect(nav.getByRole('link')).toHaveCount(5);
    for (const link of await nav.getByRole('link').all()) {
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box.x + box.width).toBeLessThanOrEqual(412);
    }
    expect(externalRequests).toEqual([]);
  });
});

test.describe('Account mode on the real Supabase project @account', () => {
  test.skip(process.env.E2E_ACCOUNT !== '1' || !hasE2ECredentials(), ACCOUNT_SKIP);

  // F: transfer comes first, with each data scenario isolated by the accountData fixture.
  test('F: account import partial failure reports progress and retry skips completed parents', async ({ accountPage, accountData }) => {
    const page = accountPage;
    const prefix = accountData.prefix;
    await page.goto('/#/settings');
    const backup = JSON.parse(simpleBackup());
    const jobId = '20000000-0000-4000-8000-000000000001';
    const appId = '20000000-0000-4000-8000-000000000002';
    backup.employments.push({ id: jobId, employer_name: prefix + ' imported job', job_title: 'Imported', hourly_rate: 10, start_date: null, end_date: null, is_current: true });
    backup.applications.push({ id: appId, company: prefix + ' imported application', position: 'Imported', source: null, job_url: null, location: null, date_applied: '2026-10-16', status: 'pending', contact_name: null, contact_email: null, notes: prefix });
    backup.shifts.push({ id: '20000000-0000-4000-8000-000000000003', employment_id: jobId, work_date: '2026-10-16', day_type: 'duty', time_in: '2026-10-16T01:00:00.000Z', time_out: '2026-10-16T02:00:00.000Z', break_minutes: 0, is_overtime: false, notes: prefix });
    const text = JSON.stringify(backup);
    let interrupted = false;
    await page.route('**/rest/v1/shifts*', async (route) => {
      if (!interrupted && route.request().method() === 'POST') {
        interrupted = true;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'E2E write interruption' }) });
      } else await route.continue();
    });
    await uploadBackup(page, 'partial.json', text);
    await page.getByRole('button', { name: 'Confirm import' }).click();
    await expect(page.getByRole('heading', { name: 'Import stopped' })).toBeVisible();
    await expect(page.locator('.transfer-run-summary')).toContainText('Jobs: added 1');
    await expect(page.locator('.transfer-run-summary')).toContainText('Applications: added 1');
    await expect(page.locator('.transfer-run-summary')).toContainText('Shifts and days off: added 0');
    await page.unroute('**/rest/v1/shifts*');
    await uploadBackup(page, 'partial-retry.json', text);
    await expect(page.getByText('Jobs: add 0, skip 1')).toBeVisible();
    await expect(page.getByText('Applications: add 0, skip 1')).toBeVisible();
    await expect(page.getByText('Shifts and days off: add 1')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm import' }).click();
    await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible();
    expect(interrupted).toBe(true);
  });

  test('F: move local data to the account, keep the default copy, and delete only after confirmation', async ({ accountPage, accountData }) => {
    const page = accountPage;
    const prefix = accountData.prefix;
    await page.evaluate(() => localStorage.setItem('workpath.storageMode', 'local'));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Set up your profile' })).toBeVisible();
    await completeOnboarding(page, { displayName: 'Move E2E', mode: 'employed' });
    await createJob(page, { name: prefix + ' local job', title: 'Local', rate: '25' });
    await createShift(page, { date: '2026-10-16', timeIn: '09:00', timeOut: '10:00', breakMinutes: '0', jobName: prefix + ' local job', notes: prefix });
    await ensureMode(page, 'job_seeker');
    await createApplication(page, { company: prefix + ' local app', notes: prefix });

    await page.evaluate(() => localStorage.setItem('workpath.storageMode', 'account'));
    await page.reload();
    await page.goto('/#/app');
    await expect(page).toHaveURL(/#\/app$/);
    await page.goto('/#/settings');
    await expect(page.getByText('Data saved on this device')).toBeVisible();
    await page.getByRole('button', { name: 'Move to my account' }).click();
    await expect(page.getByRole('heading', { name: 'Preview move to your account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm move' })).toBeEnabled();
    await page.getByRole('button', { name: 'Confirm move' }).click();
    await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible();
    await expect(page.getByText('The local copy will remain on this device.')).toBeVisible();
    await expect(page.getByLabel('Keep the local copy (recommended)')).toBeChecked();
    await page.getByLabel('Delete data on this device').check();
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await page.getByRole('button', { name: 'Delete data on this device' }).click();
    await expect(page.getByText('The local copy was deleted.')).toBeVisible();
  });

  // C: clear paydays through the authenticated repo before the no-anchor assertion.
  test('C: payroll estimates, validation, employment links and biweekly no-anchor prompt', async ({ accountPage, accountData }) => {
    const page = accountPage;
    const prefix = accountData.prefix;
    const jobA = prefix + ' Rate A';
    const jobB = prefix + ' Rate B';
    await ensureMode(page, 'employed');
    await page.evaluate(async () => {
      const { getRepo } = await import('/src/js/data/index.js');
      const repo = getRepo();
      const entries = await repo.payrollEntries.list({ limit: 5000 });
      for (const entry of entries) await repo.payrollEntries.remove(entry.id);
    });
    await saveSettings(page, { payFrequency: 'biweekly' });
    await page.goto('/#/employed/pay');
    await page.getByRole('button', { name: 'Add a payday' }).click();
    await page.getByLabel('Pay date').fill('2026-10-11');
    await page.getByLabel('Net').fill('1');
    await page.getByLabel('Notes (optional)').fill(prefix + ' no anchor');
    await page.getByRole('button', { name: 'Fill period dates' }).click();
    await expect(page.getByText('Log a payday with period dates before filling a biweekly period.')).toBeVisible();
    await page.getByRole('button', { name: 'Add payday' }).click();

    await createJob(page, { name: jobA, title: 'Rate A', rate: '100' });
    await createJob(page, { name: jobB, title: 'Rate B', rate: '50' });
    await createShift(page, { date: '2026-10-12', timeIn: '09:00', timeOut: '11:00', breakMinutes: '0', jobName: jobA, notes: prefix });
    await createShift(page, { date: '2026-10-13', timeIn: '09:00', timeOut: '12:00', breakMinutes: '0', jobName: jobB, notes: prefix });
    await page.goto('/#/employed/pay');
    await page.getByRole('button', { name: 'Add a payday' }).click();
    await page.getByLabel('Pay date').fill('2026-10-16');
    await page.getByLabel('Employer (optional)').selectOption({ label: `${jobA} · Rate A` });
    await page.getByLabel('Period start (optional)').fill('2026-10-12');
    await page.getByLabel('Period end (optional)').fill('2026-10-18');
    await page.getByLabel('Gross (optional)').fill('200');
    await page.getByLabel('Net').fill('180');
    await page.getByLabel('Notes (optional)').fill(prefix + ' linked payday');
    await page.getByRole('button', { name: 'Add payday' }).click();
    await expect(page.getByText('Matches estimate')).toBeVisible();

    await page.getByRole('button', { name: 'Add a payday' }).click();
    await page.getByLabel('Pay date').fill('2026-10-15');
    await page.getByLabel('Employer (optional)').selectOption('');
    await page.getByLabel('Period start (optional)').fill('2026-10-12');
    await page.getByLabel('Period end (optional)').fill('2026-10-18');
    await page.getByLabel('Gross (optional)').fill('100');
    await page.getByLabel('Net').fill('100');
    await page.getByLabel('Notes (optional)').fill(prefix + ' below');
    await page.getByRole('button', { name: 'Add payday' }).click();
    await expect(page.getByText(/Gross is .* below estimate/)).toBeVisible();

    await page.goto('/#/employed/jobs');
    const card = page.locator('.record-card').filter({ hasText: jobA });
    await card.getByRole('button', { name: 'Delete' }).click();
    await card.getByRole('button', { name: 'Delete job' }).click();
    await page.goto('/#/employed/pay');
    await expect(page.locator('.payroll-entry-card').filter({ hasText: prefix + ' linked payday' })
      .getByText('No employer', { exact: true })).toBeVisible();
  });

  // D: employment statistics.
  test('D: employment statistics escape names and show the unrated-shift note', async ({ accountPage, accountData }) => {
    const page = accountPage;
    const prefix = accountData.prefix;
    await ensureMode(page, 'employed');
    await createJob(page, { name: prefix + ' <b>x</b>', title: 'HTML test', rate: '80' });
    await createJob(page, { name: prefix + ' no rate', title: 'Unrated', rate: null });
    await createShift(page, { date: '2026-10-14', timeIn: '22:00', timeOut: '06:00', breakMinutes: '60', jobName: prefix + ' <b>x</b>', notes: prefix, overtime: true });
    await createShift(page, { date: '2026-09-14', timeIn: '09:00', timeOut: '10:00', breakMinutes: '0', jobName: prefix + ' no rate', notes: prefix });
    await page.goto('/#/employed/stats');
    await page.getByLabel('Time range').selectOption('3');
    const htmlJobRow = page.getByRole('rowheader').filter({ hasText: prefix + ' <b>x</b>' });
    await expect(htmlJobRow).toBeVisible();
    await expect(htmlJobRow.locator('b, script')).toHaveCount(0);
    await expect(page.getByText(/unrated shift/)).toBeVisible();
    await page.getByRole('link', { name: 'Stats' }).click();
    await expect(page.getByLabel('Time range')).toHaveValue('3');
  });

  // E: Job Seeker status and timeline flows.
  test('E: seeker applications, response rate, search, status event and timeline event', async ({ accountPage, accountData }) => {
    const page = accountPage;
    const prefix = accountData.prefix;
    await ensureMode(page, 'job_seeker');
    for (let index = 0; index < 4; index += 1) {
      await createApplication(page, {
        company: `${prefix} application ${index}`,
        status: ['pending', 'interview', 'offer', 'rejected'][index],
        date: `2026-10-${String(10 + index).padStart(2, '0')}`,
        notes: prefix,
        contactEmail: index === 0 ? 'test@example.test' : undefined
      });
    }
    await page.goto('/#/seeker/stats');
    await expect(page.getByText('Not enough data yet', { exact: true })).toBeVisible();
    await createApplication(page, { company: `${prefix} application 4`, status: 'no_response', date: '2026-10-14', notes: prefix });
    await page.goto('/#/seeker/stats');
    await expect(page.getByText('80%', { exact: true })).toBeVisible();
    await page.goto('/#/seeker/applications');
    await page.getByLabel('Search company or position').fill('application 4');
    await expect(page.getByRole('heading', { name: `${prefix} application 4` })).toBeVisible();
    await page.getByLabel('Search company or position').fill('');
    const appCard = page.locator('.application-card').filter({ hasText: `${prefix} application 4` });
    await appCard.getByLabel('Change status').selectOption('interview');
    await appCard.locator('details').locator('summary').click();
    await expect(appCard.getByRole('heading', { name: 'Status changed' })).toBeVisible();
    await appCard.getByRole('button', { name: 'Add event' }).click();
    await page.getByLabel('Event type').selectOption('interview');
    await page.getByLabel('Notes (optional)').last().fill(prefix + ' interview event');
    await page.getByRole('button', { name: 'Save event' }).click();
    await expect(appCard.getByText(prefix + ' interview event')).toBeVisible();
  });

  // B: Jobs and shifts.
  test('B: jobs, normal and overnight shifts, month navigation and deletion', async ({ accountPage, accountData }) => {
    const page = accountPage;
    const prefix = accountData.prefix;
    const jobName = prefix + ' Job';
    await ensureMode(page, 'employed');
    await createJob(page, { name: jobName, title: prefix + ' title', rate: '100' });
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await page.getByLabel('Job title').fill(prefix + ' edited title');
    await page.getByRole('button', { name: 'Save job' }).click();
    await expect(page.getByText(prefix + ' edited title', { exact: true })).toBeVisible();
    await createShift(page, { date: '2026-10-14', timeIn: '09:00', timeOut: '17:30', breakMinutes: '30', jobName, notes: prefix });
    await expect(page.locator('.worked-time-badge').filter({ hasText: '8h 0m' })).toBeVisible();
    await createShift(page, { date: '2026-10-15', timeIn: '22:00', timeOut: '06:00', breakMinutes: '60', jobName, notes: prefix, overtime: true });
    const overnight = page.locator('.shift-card').first();
    await expect(overnight.getByText('7h 0m', { exact: true })).toBeVisible();
    await expect(overnight.getByText(/next day/)).toBeVisible();
    await expect(overnight.getByText('Overtime', { exact: true })).toBeVisible();
    await expect(page.getByText('Days worked').locator('..')).toContainText('2');
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByRole('heading', { name: 'September 2026' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No shifts this month' })).toBeVisible();
    await page.getByRole('button', { name: 'Next month' }).click();
    await page.goto('/#/employed/jobs');
    const card = page.locator('.record-card').filter({ hasText: jobName });
    await card.getByRole('button', { name: 'Delete' }).click();
    await card.getByRole('button', { name: 'Delete job' }).click();
    await expect(page.getByRole('heading', { name: jobName })).toHaveCount(0);
  });

  // G: Cross-cutting state, routing and offline account handling.
  test('G: route guards, Settings tab behavior, mode switching and network failure', async ({ accountPage, accountData }) => {
    const page = accountPage;
    const prefix = accountData.prefix;
    await page.evaluate(async () => {
      const { getRepo } = await import('/src/js/data/index.js');
      await getRepo().profile.update({ onboarded: false });
    });
    await page.goto('/#/app');
    await expect(page).toHaveURL(/#\/onboarding$/);
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page).toHaveURL(/#\/app$/);
    await page.goto('/#/onboarding');
    await expect(page).toHaveURL(/#\/app$/);
    await page.goto('/#/settings');
    await expect(page.getByText('Account (online)', { exact: true })).toBeVisible();
    await saveSettings(page, { currency: 'PHP', payFrequency: 'weekly', timezone: 'Asia/Manila' });
    await page.getByLabel('Pay frequency').selectOption('monthly');
    const otherTab = await page.context().newPage();
    await otherTab.goto('/#/app');
    await expect(otherTab.getByRole('heading', { name: /Hello/ })).toBeVisible();
    await page.bringToFront();
    await expect(page.getByLabel('Pay frequency')).toHaveValue('monthly');
    await otherTab.close();
    await saveSettings(page, { payFrequency: 'weekly' });

    await ensureMode(page, 'employed');
    await createJob(page, { name: prefix + ' persistent job', title: 'Persistent', rate: '50' });
    await chooseMode(page, 'job_seeker', { waitForUpdate: true });
    await page.goto('/#/employed/jobs');
    await expect(page).toHaveURL(/#\/app$/);
    await chooseMode(page, 'employed', { waitForUpdate: true });
    await page.goto('/#/employed/jobs');
    await expect(page.getByRole('heading', { name: prefix + ' persistent job' })).toBeVisible();

    await page.context().setOffline(true);
    try {
      await page.goto('/#/employed/stats');
      await expect(page.getByRole('alert')).toContainText('We could not reach the database');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
      expect(await page.locator('.stats-chart').count()).toBe(0);
    } finally {
      await page.context().setOffline(false);
    }
  });

  // A: Fresh auth contexts run last; the only console allowance is the specific failed token request below.
  test('A: wrong password and client-side login/signup validation @fresh', async ({ page, browserErrorAllowance }) => {
    await page.goto('/#/login');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.goto('/#/employed/jobs');
    await expect(page).toHaveURL(/#\/login$/);
    await page.getByLabel('Email address').fill('bad-address');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Enter a valid email address.');
    await page.getByLabel('Email address').fill('wrong-password@example.invalid');
    await page.getByLabel('Password').fill('wrong-password-not-a-secret');
    const rejectedToken = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/auth/v1/token')
        && url.searchParams.get('grant_type') === 'password'
        && response.status() === 400;
    });
    browserErrorAllowance.allowFailedAuthToken400();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await rejectedToken;
    await expect(page.getByRole('alert')).toContainText('did not match');
    await page.goto('/#/signup');
    await page.getByLabel('Email address').fill('bad-address');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toContainText('Enter a valid email address.');
  });

  test('A: fresh account login succeeds through #/login @fresh', async ({ page }) => {
    await page.goto('/#/login');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.getByLabel('Email address').fill(process.env.E2E_EMAIL);
    await page.getByLabel('Password').fill(process.env.E2E_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/#\/app$/);
    await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  });

  test('A: logout after fresh login @fresh', async ({ page }) => {
    await page.goto('/#/login');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.getByLabel('Email address').fill(process.env.E2E_EMAIL);
    await page.getByLabel('Password').fill(process.env.E2E_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/#\/app$/);
    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/#\/login$/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });
});
