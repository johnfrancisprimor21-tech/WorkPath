import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const APP_ORIGIN = 'http://127.0.0.1:4173';

test('local app shell opens offline and saved shifts survive a cold reload', async ({ page, context }) => {
  const externalRequests = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.name));
  page.on('requestfailed', (request) => failedRequests.push({
    path: new URL(request.url()).pathname,
    error: request.failure()?.errorText || 'unknown network failure'
  }));
  await page.clock.install({ time: new Date('2026-10-16T12:00:00.000Z') });
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== APP_ORIGIN) externalRequests.push('external-origin-request');
  });

  await page.goto('/#/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByRole('button', { name: 'Use without an account' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your profile' })).toBeVisible();
  await page.getByLabel('Display name (optional)').fill('PWA Local');
  await page.locator('input[name="mode"][value="employed"]').check();
  await page.getByLabel('Currency').selectOption('PHP');
  await page.getByLabel('Pay frequency').selectOption('weekly');
  await page.getByLabel('Time zone').selectOption('Asia/Manila');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, PWA Local' })).toBeVisible();
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Install app' })).toBeVisible();
  await page.goto('/#/app');

  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const manifestAndIcons = await page.evaluate(async () => {
    const manifest = await fetch('./manifest.webmanifest').then((response) => response.json());
    const iconResults = await Promise.all(manifest.icons.map(async (icon) => ({
      path: icon.src,
      ok: (await fetch(icon.src)).ok
    })));
    return { manifest, iconResults };
  });
  expect(manifestAndIcons.manifest.display).toBe('standalone');
  expect(manifestAndIcons.iconResults.every((icon) => icon.ok)).toBe(true);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  const installability = await cdp.send('Page.getInstallabilityErrors');
  expect(installability.installabilityErrors).toEqual([]);

  await context.setOffline(true);
  await page.reload();
  const homeHeading = page.getByRole('heading', { name: 'Hello, PWA Local' });
  if (!await homeHeading.isVisible().catch(() => false)) {
    const offlineState = await page.evaluate(async () => ({
      text: document.body.innerText,
      controller: Boolean(navigator.serviceWorker.controller),
      cacheNames: await caches.keys(),
      cachedPaths: await Promise.all((await caches.keys()).map(async (name) =>
        (await caches.open(name)).keys().then((requests) => requests.map((request) => new URL(request.url).pathname))))
    })).catch(() => ({ text: 'document unavailable', controller: false, cacheNames: [], cachedPaths: [] }));
    throw new Error('Offline reload did not render the local home screen. ' + JSON.stringify({ offlineState, pageErrors, failedRequests }));
  }
  await page.goto('/#/employed/shifts');
  await expect(page.getByRole('heading', { name: 'Shifts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log a shift' }).first().click();
  await page.getByLabel('Work date').fill('2026-10-16');
  await page.getByLabel('Time in').fill('22:00');
  await page.getByLabel('Time out').fill('06:00');
  await page.getByLabel('Break (minutes)').fill('60');
  await page.getByRole('button', { name: 'Save shift' }).click();
  await expect(page.getByRole('article').getByText('7h 0m', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('article').getByText('7h 0m', { exact: true })).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test('external Supabase requests bypass the service worker and reach the network layer', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('workpath.storageMode', 'account'));
  await page.goto('/#/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  const routedRequests = [];
  await page.route('https://workpath-pwa-test.supabase.co/**', async (route) => {
    routedRequests.push(route.request().url());
    await route.abort('internetdisconnected');
  });
  const result = await page.evaluate(async () => {
    try {
      await fetch('https://workpath-pwa-test.supabase.co/rest/v1/profiles');
      return 'resolved';
    } catch (error) {
      return error.name;
    }
  });
  expect(result).toBe('TypeError');
  expect(routedRequests).toHaveLength(1);
});

test('update banner preserves typed settings and reload activates the new cache', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T12:00:00.000Z') });
  await page.goto('/#/login');
  await page.getByRole('button', { name: 'Use without an account' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your profile' })).toBeVisible();
  await page.getByLabel('Display name (optional)').fill('PWA Update');
  await page.getByLabel('Currency').selectOption('PHP');
  await page.getByLabel('Pay frequency').selectOption('weekly');
  await page.getByLabel('Time zone').selectOption('Asia/Manila');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, PWA Update' })).toBeVisible();
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Install app' })).toBeVisible();
  await page.getByLabel('Currency').selectOption('USD');
  const currency = page.getByLabel('Currency');
  await expect(currency).toHaveValue('USD');

  const swPath = resolve('dist/sw.js');
  const indexPath = resolve('dist/index.html');
  const originalSw = await readFile(swPath, 'utf8');
  const originalIndex = await readFile(indexPath);
  const cacheName = originalSw.match(/const CACHE_NAME = "(workpath-shell-[a-f0-9]+)";/)?.[1];
  expect(cacheName).toBeTruthy();
  const cacheNamesBefore = await page.evaluate(() => caches.keys());
  expect(cacheNamesBefore).toContain(cacheName);

  try {
    const nextCacheName = 'workpath-shell-' + randomBytes(6).toString('hex');
    const updatedSw = originalSw.replace(cacheName, nextCacheName);
    expect(updatedSw).not.toBe(originalSw);
    await writeFile(swPath, updatedSw);
    const updatedIndex = originalIndex.toString('utf8').replace(
      '</head>',
      '<meta name="pwa-test-build" content="B" /></head>'
    );
    expect(updatedIndex).not.toBe(originalIndex.toString('utf8'));
    await writeFile(indexPath, updatedIndex);

    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
    });
    const banner = page.getByRole('status').filter({ hasText: 'A new version is ready' });
    await expect(banner).toBeVisible();
    await expect(currency).toHaveValue('USD');

    const reloadComplete = page.waitForEvent('load');
    await banner.getByRole('button', { name: 'Reload' }).click();
    await reloadComplete;
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('meta[name="pwa-test-build"]')).toHaveAttribute('content', 'B');
    const cacheNamesAfter = await page.evaluate(() => caches.keys());
    const appCachesAfter = cacheNamesAfter.filter((name) => name.startsWith('workpath-shell-'));
    expect(appCachesAfter).toEqual([nextCacheName]);
    expect(appCachesAfter).not.toContain(cacheName);
  } finally {
    await writeFile(swPath, originalSw);
    await writeFile(indexPath, originalIndex);
  }
});
