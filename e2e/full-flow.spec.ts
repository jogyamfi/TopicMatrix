import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Full acceptance walkthrough (delivery-plan.md P10 task 6): first-run admin seed \u2192 login \u2192
// forced password change \u2192 create subject and tree \u2192 log sessions \u2192 queue/launcher \u2192
// analytics \u2192 export \u2192 settings. Runs against `scripts/e2e-server.mjs`'s dedicated scratch
// SQLite database (see playwright.config.ts) \u2014 the seeded admin's credentials are fixed there,
// not generated randomly like the real `seed:admin` CLI's normal (non-test) behaviour.
const SEEDED_EMAIL = 'admin@example.com';
const SEEDED_PASSWORD = 'E2eAdminPass123!';
const NEW_PASSWORD = 'NewSecurePassword456!';

test.describe.configure({ mode: 'serial' });

/**
 * Asserts a toast is showing. Radix Toast briefly renders a visually-hidden copy of each new
 * toast for screen-reader announcement, so a plain getByText can match twice (seen against the
 * faster production build) — this checks the visible toast only.
 */
async function expectToast(page: Page, text: string): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: text }).first()).toBeVisible();
}

test('first-run admin seed through export (P10 acceptance criteria)', async ({ page }) => {
  await test.step('login with the seeded temporary password', async () => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(SEEDED_EMAIL);
    await page.getByLabel('Password').fill(SEEDED_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/change-password$/);
  });

  await test.step('forced password change', async () => {
    await page.getByLabel('Current password').fill(SEEDED_PASSWORD);
    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  await test.step('login again with the new password', async () => {
    await page.getByLabel('Email').fill(SEEDED_EMAIL);
    await page.getByLabel('Password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
  });

  await test.step('create a subject and a topic', async () => {
    await page.getByRole('link', { name: 'Subjects' }).click();
    await page.getByRole('button', { name: 'New subject' }).first().click();
    await page.getByLabel('Name', { exact: true }).fill('Mathematics');
    await page.getByRole('button', { name: 'Create subject' }).click();
    await expect(page.getByRole('link', { name: 'Mathematics' })).toBeVisible();

    await page.getByRole('link', { name: 'Mathematics' }).click();
    await page.getByRole('button', { name: 'Add topic' }).first().click();
    await page.getByLabel('Name', { exact: true }).fill('Algebra');
    await page.getByRole('button', { name: 'Create topic' }).click();
    await expect(page.getByText('Algebra')).toBeVisible();

    // A second topic that stays unstudied, for the queue's "Not started yet" section (R3).
    await page.getByRole('button', { name: 'Add topic' }).first().click();
    await page.getByLabel('Name', { exact: true }).fill('Geometry');
    await page.getByRole('button', { name: 'Create topic' }).click();
    await expect(page.getByText('Geometry')).toBeVisible();
  });

  await test.step('log a study session on the topic', async () => {
    await page.getByRole('button', { name: 'Log session: Algebra' }).click();
    const dialog = page.getByRole('dialog');

    // Field-level validation (R3): the message sits next to the field, which is marked invalid
    // and focused, and nothing is sent.
    await dialog.getByLabel('Questions attempted').fill('5');
    await dialog.getByLabel('Questions correct').fill('8');
    await dialog.getByRole('button', { name: 'Log session' }).click();
    await expect(dialog.getByText('Questions correct cannot be more than questions attempted')).toBeVisible();
    await expect(dialog.getByLabel('Questions correct')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByLabel('Questions correct')).toBeFocused();

    await dialog.getByLabel('Questions attempted').fill('10');
    await dialog.getByLabel('Questions correct').fill('8');
    await dialog.getByRole('button', { name: 'Log session' }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step('the review queue lists never-studied topics separately', async () => {
    await page.getByRole('link', { name: 'Review' }).click();
    const notStarted = page.locator('details').filter({ hasText: 'Not started yet' });
    await expect(notStarted).toContainText('(1)');
    // Collapsed while something is due (Algebra is now scheduled this week) — expand it.
    await notStarted.getByText('Not started yet').click();
    await expect(notStarted.getByRole('link', { name: 'Geometry' })).toBeVisible();
    await expect(notStarted.getByRole('button', { name: 'Log first session' })).toBeVisible();
  });

  await test.step('start and complete a review launcher session', async () => {
    await page.getByRole('button', { name: 'Start review session' }).click();
    const launchDialog = page.getByRole('dialog');
    await launchDialog.getByRole('combobox', { name: 'Review' }).click();
    await page.getByRole('option', { name: 'Weakest topics first' }).click();
    await launchDialog.getByRole('button', { name: 'Start review' }).click();
    await expect(page).toHaveURL(/\/review\/launch$/);

    // Keyboard shortcut (R3): L opens "Log result".
    await expect(page.getByRole('button', { name: 'Log result' })).toBeVisible();
    await page.keyboard.press('l');
    const logDialog = page.getByRole('dialog');
    await logDialog.getByLabel('Questions attempted').fill('9');
    await logDialog.getByLabel('Questions correct').fill('7');
    await logDialog.getByRole('button', { name: 'Log session' }).click();
    await expect(page.getByText('Session complete')).toBeVisible();
    // The summary reports what happened, including accuracy across the sessions logged.
    await expect(page.getByText(/1 logged\. Accuracy across the sessions you logged: 78%\./)).toBeVisible();
  });

  await test.step('view analytics', async () => {
    await page.getByRole('link', { name: 'Analytics' }).click();
    await expect(page.getByRole('tab', { name: 'Health view' })).toBeVisible();
    await page.getByRole('tab', { name: 'Mastery' }).click();
    await expect(page.getByRole('tabpanel')).toBeVisible();
  });

  await test.step('export data', async () => {
    await page.getByRole('link', { name: 'Export' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download JSON export' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('topicmatrix-export.json');
  });

  await test.step('change settings', async () => {
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByLabel('Day starts at (hour, 0-23)').fill('5');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expectToast(page, 'Settings saved');
  });
});

test('dashboard and settings pages have no serious/critical accessibility violations (NF-4)', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(SEEDED_EMAIL);
  await page.getByLabel('Password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();

  const dashboardScan = await new AxeBuilder({ page }).analyze();
  const dashboardSerious = dashboardScan.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(dashboardSerious, JSON.stringify(dashboardSerious, null, 2)).toHaveLength(0);

  await page.getByRole('link', { name: 'Settings' }).click();
  const settingsScan = await new AxeBuilder({ page }).analyze();
  const settingsSerious = settingsScan.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(settingsSerious, JSON.stringify(settingsSerious, null, 2)).toHaveLength(0);

  // The review queue, including R3's "Not started yet" section.
  await page.getByRole('link', { name: 'Review' }).click();
  await expect(page.getByText('Not started yet')).toBeVisible();
  const reviewScan = await new AxeBuilder({ page }).analyze();
  const reviewSerious = reviewScan.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(reviewSerious, JSON.stringify(reviewSerious, null, 2)).toHaveLength(0);
});

test.describe('on a device in another timezone', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('offers to switch the account to the device timezone (R3)', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(SEEDED_EMAIL);
    await page.getByLabel('Password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    const banner = page.getByRole('region', { name: 'Timezone' });
    await expect(banner).toContainText('America/New_York');
    await banner.getByRole('button', { name: 'Use America/New_York' }).click();
    await expectToast(page, 'Now using America/New_York.');
    await expect(banner).toBeHidden();
  });
});
