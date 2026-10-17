import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const iconDirectory = resolve(projectRoot, 'public/icons');
await mkdir(iconDirectory, { recursive: true });
const svg = await readFile(resolve(iconDirectory, 'workpath.svg'), 'utf8');
const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}img{display:block;width:100%;height:100%}</style><img id="icon" alt="" src="${dataUrl}">`);
  await page.locator('#icon').evaluate((image) => image.decode());

  for (const [size, fileName] of [
    [192, 'icon-192.png'],
    [512, 'icon-512.png'],
    [512, 'icon-maskable-512.png'],
    [180, 'apple-touch-icon.png']
  ]) {
    await page.setViewportSize({ width: size, height: size });
    await page.locator('#icon').screenshot({ path: resolve(iconDirectory, fileName), animations: 'disabled' });
  }
} finally {
  await browser.close();
}
