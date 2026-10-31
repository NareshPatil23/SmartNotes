// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
          args: ['--no-sandbox']
        }
      },
    },
    {
      name: 'edge',
      use: { 
        ...devices['Desktop Edge'],
        launchOptions: {
          executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
          args: ['--no-sandbox']
        }
      },
    }
  ],
});
