const path = require('node:path');

const playwrightDirectory = process.env.WORKPATH_PLAYWRIGHT_DIR;
if (!playwrightDirectory) {
  throw new Error('Set WORKPATH_PLAYWRIGHT_DIR to the directory containing the external Playwright installation.');
}

const { chromium } = require(path.join(playwrightDirectory, 'node_modules', 'playwright'));
const testUrl = process.env.WORKPATH_BROWSER_TEST_URL || 'http://127.0.0.1:5173/tests/browser/payroll.html';

async function run() {
  const launchOptions = { headless: true };
  if (process.env.WORKPATH_CHROME_EXECUTABLE) {
    launchOptions.executablePath = process.env.WORKPATH_CHROME_EXECUTABLE;
  }
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    const response = await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 30000 });
    if (!response || response.status() >= 400) {
      throw new Error(`Could not load the browser test page (HTTP ${response?.status() ?? 'no response'}).`);
    }

    await page.waitForFunction(
      () => document.querySelector('#test-summary')?.textContent.includes('across local and account-mode adapters.'),
      null,
      { timeout: 60000 }
    );
    const summary = await page.locator('#test-summary').innerText();
    const results = await page.locator('#test-results li').allInnerTexts();
    console.log(summary);
    for (const result of results) console.log(result);

    const counts = summary.match(/^(\d+) passed, (\d+) failed/);
    if (!counts || results.length !== Number(counts[1]) + Number(counts[2]) || Number(counts[2]) > 0) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
