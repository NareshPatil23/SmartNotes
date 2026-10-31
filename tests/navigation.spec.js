// @ts-check
const { test, expect } = require('@playwright/test');

const APP_URL = process.env.APP_URL || 'http://localhost:4173';

test.describe('Workspace Navigation & Modal Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
    const demoBtn = page.locator('.btn-demo-quickstart');
    if (await demoBtn.isVisible()) {
      await demoBtn.click();
      await page.waitForSelector('.sidebar', { timeout: 10000 });
    }
  });

  test('should navigate across main workspace tabs', async ({ page }) => {
    const tabs = ['Dashboard', 'Create Notes', 'Library / Drafts', 'Summarize', 'Ask PDF', 'Templates', 'Flashcards', 'Analytics', 'Favorites', 'Trash', 'Settings'];
    for (const tab of tabs) {
      const item = page.locator('.sidebar-item').filter({ hasText: new RegExp(tab, 'i') });
      if (await item.isVisible()) {
        await item.click();
        await page.waitForTimeout(150);
      }
    }
  });

  test('should open PlanModal and close it via Escape key', async ({ page }) => {
    const upgradeBtn = page.locator('button:has-text("UPGRADE")').first();
    await upgradeBtn.click();

    const modal = page.locator('.modal-overlay');
    await expect(modal).toBeVisible();

    // Close with Escape key
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });
});
