import { expect } from './fixtures.js';

export const TEST_TIME = new Date('2026-10-16T12:00:00.000Z');

export async function enterLocalMode(page) {
  const externalRequests = [];
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== 'http://127.0.0.1:5173') {
      externalRequests.push(requestUrl.origin);
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.goto('/#/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByText('Your data is saved only on this device.', { exact: false })).toBeVisible();
  return externalRequests;
}

export async function startLocal(page, profile = {}) {
  const externalRequests = await enterLocalMode(page);
  await page.getByRole('button', { name: 'Use without an account' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your profile' })).toBeVisible();
  await completeOnboarding(page, profile);
  expect(externalRequests).toEqual([]);
  return externalRequests;
}

export async function completeOnboarding(page, {
  displayName = 'Local E2E',
  mode = 'employed',
  currency = 'PHP',
  payFrequency = 'weekly',
  timezone = 'Asia/Manila'
} = {}) {
  await page.getByLabel('Display name (optional)').fill(displayName);
  await chooseMode(page, mode);
  await page.getByLabel('Currency').selectOption(currency);
  await page.getByLabel('Pay frequency').selectOption(payFrequency);
  await page.getByLabel('Time zone').selectOption(timezone);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/#\/app$/);
}

export async function ensureMode(page, mode) {
  await page.goto('/#/app');
  await chooseMode(page, mode, { waitForUpdate: true });
  if (mode === 'employed') {
    await expect(page.getByRole('navigation', { name: 'Employed navigation' })
      .getByRole('link', { name: 'Pay', exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole('navigation', { name: 'Job seeker navigation' })
      .getByRole('link', { name: 'Applications', exact: true })).toBeVisible();
  }
}

export async function chooseMode(page, mode, { waitForUpdate = false } = {}) {
  const label = mode === 'employed' ? 'Employed' : 'Job Seeker';
  const choice = page.locator(`input[name="mode"][value="${mode}"]`);
  if (!await choice.isChecked()) {
    await page.locator('label.mode-card').filter({ has: page.getByText(label, { exact: true }) })
      .getByText(label, { exact: true }).click();
    if (waitForUpdate) {
      await expect(page.getByText('Mode updated. Your saved data stays in place.', { exact: true })).toBeVisible();
    }
  }
}

export async function saveSettings(page, { currency, payFrequency, timezone } = {}) {
  await page.goto('/#/settings');
  if (currency) await page.getByLabel('Currency').selectOption(currency);
  if (payFrequency) await page.getByLabel('Pay frequency').selectOption(payFrequency);
  if (timezone) await page.getByLabel('Time zone').selectOption(timezone);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.', { exact: true })).toBeVisible();
}

export async function createJob(page, { name, title = 'E2E role', rate = '100', current = true }) {
  await page.goto('/#/employed/jobs');
  await expect(page.getByRole('heading', { name: 'My jobs' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a job', exact: true }).click();
  await page.getByLabel('Employer name').fill(name);
  await page.getByLabel('Job title').fill(title);
  if (rate !== null) await page.getByLabel(/Hourly rate/).fill(String(rate));
  await page.getByLabel('Start date').fill('2026-01-01');
  const currentCheckbox = page.getByLabel('This is my current job');
  if (await currentCheckbox.isChecked() !== current) await currentCheckbox.setChecked(current);
  await page.getByRole('button', { name: 'Add job', exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

export async function createShift(page, {
  date = '2026-10-15', timeIn = '09:00', timeOut = '17:30', breakMinutes = '30',
  jobName, notes, overtime = false, dayType = 'duty'
} = {}) {
  await page.goto('/#/employed/shifts');
  await expect(page.getByRole('heading', { name: 'Shifts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log a shift' }).first().click();
  await page.getByLabel('Day type').selectOption(dayType);
  await page.getByLabel('Work date').fill(date);
  if (jobName) {
    const employment = page.getByLabel('Employer');
    const value = await employment.locator('option').evaluateAll((options, name) =>
      options.find((option) => option.textContent.startsWith(name))?.value || '', jobName);
    await employment.selectOption(value);
  }
  await page.getByLabel('Time in').fill(timeIn);
  await page.getByLabel('Time out').fill(timeOut);
  await page.getByLabel('Break (minutes)').fill(breakMinutes);
  if (overtime) await page.getByLabel('Overtime shift').check();
  if (notes) await page.getByLabel('Notes').fill(notes);
  await page.getByRole('button', { name: 'Save shift' }).click();
}

export async function createApplication(page, {
  company, position = 'E2E analyst', status = 'pending', date = '2026-10-15',
  notes, jobUrl, contactEmail, location = 'Manila'
}) {
  await ensureMode(page, 'job_seeker');
  await page.goto('/#/seeker/applications');
  await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();
  await page.getByRole('button', { name: 'Add an application' }).click();
  await page.getByLabel('Company', { exact: true }).fill(company);
  await page.getByLabel('Position', { exact: true }).fill(position);
  await page.getByLabel('Date applied').fill(date);
  await page.getByLabel('Status', { exact: true }).selectOption(status);
  await page.getByLabel('Location').fill(location);
  if (notes) await page.getByLabel('Notes').fill(notes);
  if (jobUrl !== undefined) await page.getByLabel('Job URL (http or https)').fill(jobUrl);
  if (contactEmail !== undefined) await page.getByLabel('Contact email').fill(contactEmail);
  await page.getByRole('button', { name: 'Save application' }).click();
  await expect(page.getByRole('heading', { name: company })).toBeVisible();
}

export async function uploadBackup(page, name, text) {
  const choose = page.getByRole('button', { name: 'Import backup (JSON)' });
  const fileChooserPromise = page.waitForEvent('filechooser');
  await choose.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(text, 'utf8')
  });
}

export async function uploadCsv(page, name, text) {
  const choose = page.getByRole('button', { name: 'Import CSV' });
  const fileChooserPromise = page.waitForEvent('filechooser');
  await choose.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(text, 'utf8')
  });
}

export function simpleBackup(overrides = {}) {
  return JSON.stringify({
    app: 'workpath',
    formatVersion: 1,
    exportedAt: '2026-10-16T12:00:00.000Z',
    source: 'local',
    profile: {
      display_name: 'Transfer E2E', mode: 'employed', currency: 'PHP',
      pay_frequency: 'weekly', timezone: 'Asia/Manila'
    },
    employments: [], shifts: [], payrollEntries: [], applications: [], applicationEvents: [],
    ...overrides
  });
}

export async function checkNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
}
