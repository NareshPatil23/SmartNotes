// @ts-check
const { test, expect } = require('@playwright/test');

const APP_URL = process.env.APP_URL || 'http://localhost:4173';

test.describe('Landing Page & Guest Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
  });

  test('should display proper page title and hero landmark', async ({ page }) => {
    await expect(page).toHaveTitle(/Smart Exam Notes|SmartNotes/i);
    const mainLandmark = page.locator('main#main-content');
    await expect(mainLandmark).toBeVisible();
    const heroTitle = page.locator('h1.hero-title');
    await expect(heroTitle).toBeVisible();
  });

  test('should toggle dark and light themes smoothly', async ({ page }) => {
    const themeBtn = page.locator('.theme-toggle-btn');
    await expect(themeBtn).toBeVisible();

    // Toggle to Dark
    await themeBtn.click();
    await expect(page.locator('.landing-page-container')).toHaveClass(/dark-theme/);

    // Toggle back to Light
    await themeBtn.click();
    await expect(page.locator('.landing-page-container')).not.toHaveClass(/dark-theme/);
  });

  test('should toggle Google OAuth Setup Instructions', async ({ page }) => {
    const setupGuideBtn = page.locator('.btn-setup-guide');
    if (await setupGuideBtn.isVisible()) {
      await setupGuideBtn.click();
      await expect(page.locator('.setup-steps-box')).toBeVisible();
      await setupGuideBtn.click();
      await expect(page.locator('.setup-steps-box')).not.toBeVisible();
    }
  });
});
