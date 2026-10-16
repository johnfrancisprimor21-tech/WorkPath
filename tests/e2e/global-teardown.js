import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { AUTH_STATE, BASE_URL, PROFILE_STATE } from './environment.js';
import { cleanupE2EPrefix, formatLeftovers } from './account-cleanup.js';

export default async function globalTeardown() {
  try {
    const profile = JSON.parse(await fs.readFile(PROFILE_STATE, 'utf8'));
    const browser = await chromium.launch();
    const context = await browser.newContext({ storageState: AUTH_STATE });
    try {
      const page = await context.newPage();
      await page.goto(BASE_URL + '/#/app');
      const cleanup = await cleanupE2EPrefix(page);
      if (cleanup.leftovers.length) {
        throw new Error(`E2E cleanup failed. Leftovers: ${formatLeftovers(cleanup)}`);
      }
      const restored = await page.evaluate(async (values) => {
        const { getSupabaseClient } = await import('/src/js/supabase.js');
        const { getRepo } = await import('/src/js/data/index.js');
        const { data, error } = await getSupabaseClient().auth.getUser();
        if (error || !data.user) return false;
        await getRepo().profile.update(values);
        return true;
      }, profile);
      if (!restored) throw new Error('E2E cleanup could not restore the dedicated account profile.');
    } finally {
      await context.close();
      await browser.close();
    }
    await fs.rm(PROFILE_STATE, { force: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
}
