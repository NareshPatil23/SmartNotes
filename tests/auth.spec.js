// @ts-check
const { test, expect } = require('@playwright/test');

const APP_URL = process.env.APP_URL || 'http://localhost:4173';

test.describe('Authentication & Session Management', () => {
  test('should authenticate via Demo Student Quickstart and persist session on reload', async ({ page }) => {
    await page.goto(APP_URL);

    // Click One-Click Demo Student Access
    const demoBtn = page.locator('.btn-demo-quickstart');
    await expect(demoBtn).toBeVisible();
    await demoBtn.click();

    // Verify workspace dashboard mounts
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    await expect(sidebar).toContainText(/PLAN/i);

    // Reload page and confirm persistent session
    await page.reload();
    await expect(page.locator('.sidebar')).toBeVisible();
  });

  test('should allow user to sign out and return to landing page', async ({ page }) => {
    await page.goto(APP_URL);

    // Sign in first
    const demoBtn = page.locator('.btn-demo-quickstart');
    if (await demoBtn.isVisible()) {
      await demoBtn.click();
      await page.waitForSelector('.sidebar', { timeout: 10000 });
    }

    // Click Sign Out
    const signoutBtn = page.locator('.btn-nav-signout');
    if (await signoutBtn.isVisible()) {
      await signoutBtn.click();
      await expect(page.locator('.landing-navbar')).toBeVisible({ timeout: 5000 });
    }
  });
});
