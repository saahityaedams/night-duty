import { defineConfig, devices } from '@playwright/test';

/**
 * Two engines at phone size:
 *  - WebKit (Safari's engine) emulating her iPhone, which catches Safari-specific bugs.
 *  - The installed Google Chrome emulating an Android phone, matching the Android test device.
 * Neither measures real phone performance; budgets here are a regression alarm, not the final word.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 15 Pro'] } },
    // --mute-audio: tests tap the game, which unlocks audio; never play it through the speakers.
    { name: 'android-chrome', use: { ...devices['Pixel 7'], channel: 'chrome', launchOptions: { args: ['--mute-audio'] } } },
  ],
});
