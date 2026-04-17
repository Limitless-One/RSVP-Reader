import { chromium, expect, test } from '@playwright/test';
import path from 'node:path';

test('options page loads from the built extension', async () => {
  const extensionPath = path.join(process.cwd(), 'dist');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const serviceWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = serviceWorker.url().split('/')[2];
  const page = await context.newPage();

  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await expect(page.locator('h2.section-title').first()).toHaveText('Playback');

  await context.close();
});
