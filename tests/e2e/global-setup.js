import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { AUTH_STATE, BASE_URL, PROFILE_STATE, hasE2ECredentials, loadE2EEnvironment } from './environment.js';
import { cleanupE2EPrefix, formatLeftovers } from './account-cleanup.js';

export default async function globalSetup() {
  loadE2EEnvironment();
  if (process.env.E2E_ACCOUNT !== '1') {
    console.log('[e2e] Account-mode tests skipped; set E2E_ACCOUNT=1 to opt in.');
    return;
  }
  if (!hasE2ECredentials()) {
    console.log('[e2e] Account-mode tests skipped; .env.e2e.local must set E2E_EMAIL and E2E_PASSWORD.');
    return;
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ timezoneId: 'Asia/Manila' });
  const page = await context.newPage();
  let stage = 'open login route';
  try {
    await page.clock.install({ time: new Date('2026-10-16T12:00:00.000Z') });
    await page.goto(BASE_URL + '/#/login');
    stage = 'submit account login form';
    await page.getByLabel('Email address').fill(process.env.E2E_EMAIL);
    await page.getByLabel('Password').fill(process.env.E2E_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    stage = 'wait for authenticated route';
    await expect(page.locator('h1, h2').filter({ hasText: /Hello|Set up your profile/ }).first()).toBeVisible({ timeout: 30_000 });
    stage = 'verify dedicated account identity';
    const identityMatches = await page.evaluate(async (expectedEmail) => {
      const { getSupabaseClient } = await import('/src/js/supabase.js');
      const { data, error } = await getSupabaseClient().auth.getUser();
      return !error && data.user?.email?.toLowerCase() === expectedEmail.toLowerCase();
    }, process.env.E2E_EMAIL);
    if (!identityMatches) throw new Error('Account login failed at the dedicated-user identity check.');

    stage = 'clean previous E2E-prefixed records';
    const cleanup = await cleanupE2EPrefix(page);
    if (cleanup.leftovers.length) {
      throw new Error(`Prior E2E cleanup failed. Leftovers: ${formatLeftovers(cleanup)}`);
    }

    stage = 'read profile baseline';
    const originalProfile = await page.evaluate(async () => {
      const { getRepo } = await import('/src/js/data/index.js');
      const profile = await getRepo().profile.get();
      return {
        display_name: profile.display_name,
        mode: profile.mode,
        currency: profile.currency,
        pay_frequency: profile.pay_frequency,
        timezone: profile.timezone,
        onboarded: profile.onboarded
      };
    });
    await fs.mkdir(path.dirname(PROFILE_STATE), { recursive: true });
    await fs.writeFile(PROFILE_STATE, JSON.stringify(originalProfile));
    if (page.url().includes('/onboarding')) {
      stage = 'complete account onboarding';
      await page.getByLabel('Display name (optional)').fill('Workpath E2E');
      await page.locator('label.mode-card').filter({ has: page.getByText('Employed', { exact: true }) })
        .getByText('Employed', { exact: true }).click();
      await page.getByLabel('Currency').selectOption('PHP');
      await page.getByLabel('Pay frequency').selectOption('biweekly');
      await page.getByLabel('Time zone').selectOption('Asia/Manila');
      await page.getByRole('button', { name: 'Save and continue' }).click();
      await expect(page).toHaveURL(/#\/app$/);
    }

    stage = 'save shared account session';
    await fs.mkdir(path.dirname(AUTH_STATE), { recursive: true });
    await context.storageState({ path: AUTH_STATE });
    console.log('[e2e] Dedicated account session saved to the ignored auth-state folder.');
  } catch (error) {
    if (String(error?.message || '').includes('Leftovers:')) throw error;
    throw new Error(`Account setup failed at step: ${stage}.`);
  } finally {
    await context.close();
    await browser.close();
  }
}
