import { defineConfig, devices } from '@playwright/test';

// Software WebGL so the 3D view renders on CI machines with no GPU.
export const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/browser',
  outputDir: 'reports/playwright-results',
  // Failures are retried as a separate `--last-failed` run in CI, so the flaky test
  // detector sees each attempt in its own JUnit file.
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    // PLAYWRIGHT_JUNIT_OUTPUT_FILE overrides this path, for retries and repeat runs
    ['junit', { outputFile: 'reports/junit/browser.xml' }],
    ['html', { outputFolder: 'reports/playwright-html', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173/',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: WEBGL_ARGS } } },
  ],
  webServer: {
    command: 'node tests/serve.mjs 4173',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: !process.env.CI,
  },
});
