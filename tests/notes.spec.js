// @ts-check
const { test, expect } = require('@playwright/test');

const APP_URL = process.env.APP_URL || 'http://localhost:4173';

test.describe('Note CRUD & Editor Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
    // Sign in if needed
    const demoBtn = page.locator('.btn-demo-quickstart');
    if (await demoBtn.isVisible()) {
      await demoBtn.click();
      await page.waitForSelector('.sidebar', { timeout: 10000 });
    }
  });

  test('should create, edit, and view note in library', async ({ page }) => {
    // Navigate to Create Notes
    const createTab = page.locator('.sidebar-item').filter({ hasText: /create/i });
    await createTab.click();

    // Type Title
    const titleInput = page.locator('.editor-title-input');
    await titleInput.fill('Playwright Chemistry Examination Note');

    // Type Question
    const questionInput = page.locator('.editor-block textarea');
    await questionInput.fill('Define Le Chatelier Principle and give an example.');

    // Wait for auto-save debounce (3 seconds)
    await page.waitForTimeout(3500);

    // Switch to Library tab
    const libraryTab = page.locator('.sidebar-item').filter({ hasText: /library/i });
    await libraryTab.click();

    // Check that note appears in library
    await expect(page.locator('.page-container')).toContainText('Playwright Chemistry Examination Note');
  });
});
