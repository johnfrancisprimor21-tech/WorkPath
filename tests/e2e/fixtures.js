import { randomUUID } from 'node:crypto';
import { test as base, expect } from '@playwright/test';
import { AUTH_STATE, BASE_URL, hasE2ECredentials } from './environment.js';
import { cleanupE2EPrefix, formatLeftovers } from './account-cleanup.js';

const FIXED_TIME = '2026-10-16T12:00:00.000Z';
const ACCOUNT_PROJECT = 'account-desktop';

export const test = base.extend({
  accountPage: [async ({ browser }, use, workerInfo) => {
    if (workerInfo.project.name !== ACCOUNT_PROJECT
      || process.env.E2E_ACCOUNT !== '1'
      || !hasE2ECredentials()) {
      await use(null);
      return;
    }

    let context;
    let stage = 'create shared account context';
    try {
      context = await browser.newContext({
        storageState: AUTH_STATE,
        timezoneId: 'Asia/Manila',
        viewport: { width: 1280, height: 900 }
      });
      const page = await context.newPage();
      await page.clock.install({ time: new Date(FIXED_TIME) });
      stage = 'restore the saved session on the shared page';
      await page.goto(BASE_URL + '/#/app');
      await expect(page).toHaveURL(/#\/app$/);
      stage = 'verify the authenticated user and profile';
      const identity = await page.evaluate(async (expectedEmail) => {
        const { getSupabaseClient } = await import('/src/js/supabase.js');
        const { getRepo } = await import('/src/js/data/index.js');
        const { data, error } = await getSupabaseClient().auth.getUser();
        if (error || !data.user) return false;
        const profile = await getRepo().profile.get();
        return data.user.email?.toLowerCase() === expectedEmail.toLowerCase() && Boolean(profile);
      }, process.env.E2E_EMAIL);
      if (!identity) throw new Error('Account session failed at the shared desktop identity check.');

      await use(page);
      stage = 'save the refreshed shared session';
      await context.storageState({ path: AUTH_STATE });
    } catch (error) {
      if (error?.message === 'Account session failed at the shared desktop identity check.') throw error;
      throw new Error(`Account session failed at step: ${stage}.`);
    } finally {
      await context?.close();
    }
  }, { scope: 'worker' }],

  page: async ({ context, accountPage }, use, testInfo) => {
    const isAccount = testInfo.titlePath.some((part) => part.includes('@account'));
    const isFresh = testInfo.titlePath.some((part) => part.includes('@fresh'));
    if (isAccount && !isFresh) {
      if (!accountPage) throw new Error('Account page unavailable outside account-desktop.');
      await use(accountPage);
      return;
    }
    const page = await context.newPage();
    await page.clock.install({ time: new Date(FIXED_TIME) });
    await use(page);
  },

  browserErrorAllowance: [async ({ page, accountPage }, use, testInfo) => {
    const isAccount = testInfo.titlePath.some((part) => part.includes('@account'));
    const isFresh = testInfo.titlePath.some((part) => part.includes('@fresh'));
    const target = isAccount && !isFresh && accountPage ? accountPage : page;
    const context = target.context();
    let pageErrors = 0;
    let consoleErrors = 0;
    let allowAuthToken400 = false;
    const expectedAuth400Urls = new Set();
    const watchedPages = new Set();
    const watchPage = (observedPage) => {
      if (watchedPages.has(observedPage)) return;
      watchedPages.add(observedPage);
      observedPage.on('pageerror', onPageError);
      observedPage.on('console', onConsole);
    };
    const onPageError = () => { pageErrors += 1; };
    const onResponse = (response) => {
      if (!allowAuthToken400 || response.status() !== 400) return;
      try {
        const url = new URL(response.url());
        if (url.pathname.endsWith('/auth/v1/token') && url.searchParams.get('grant_type') === 'password') {
          expectedAuth400Urls.add(url.href);
        }
      } catch {
        // Invalid response URLs are never exempted.
      }
    };
    const onConsole = (message) => {
      if (message.type() !== 'error') return;
      const locationUrl = message.location().url;
      let expectedUrl = null;
      for (const url of expectedAuth400Urls) {
        if (locationUrl === url && /\b400\b/.test(message.text())) {
          expectedUrl = url;
          break;
        }
      }
      if (expectedUrl) {
        expectedAuth400Urls.delete(expectedUrl);
        return;
      }
      consoleErrors += 1;
    };
    for (const observedPage of context.pages()) watchPage(observedPage);
    context.on('page', watchPage);
    target.on('response', onResponse);
    try {
      await use({
        allowFailedAuthToken400() {
          allowAuthToken400 = true;
        }
      });
      expect(pageErrors).toBe(0);
      expect(consoleErrors).toBe(0);
    } finally {
      context.off('page', watchPage);
      target.off('response', onResponse);
      for (const observedPage of watchedPages) {
        observedPage.off('pageerror', onPageError);
        observedPage.off('console', onConsole);
      }
    }
  }, { auto: true }],

  accountData: async ({ accountPage }, use, testInfo) => {
    const isAccount = testInfo.titlePath.some((part) => part.includes('@account'));
    const isFresh = testInfo.titlePath.some((part) => part.includes('@fresh'));
    if (!isAccount || isFresh || !accountPage) {
      await use(null);
      return;
    }
    await accountPage.goto('/#/app');
    const previous = await cleanupE2EPrefix(accountPage);
    if (previous.leftovers.length) {
      throw new Error(`Account scenario could not clear its E2E data: ${formatLeftovers(previous)}`);
    }
    const data = { prefix: 'E2E-' + randomUUID() };
    try {
      await use(data);
    } finally {
      const cleanup = await cleanupE2EPrefix(accountPage, data.prefix);
      if (cleanup.leftovers.length) {
        throw new Error(`Account test cleanup failed. Leftovers: ${formatLeftovers(cleanup)}`);
      }
    }
  }
});

export { expect };
