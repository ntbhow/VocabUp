import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

type BrowserDiagnostics = { consoleErrors: string[]; pageErrors: string[]; failedRequests: string[]; badApiResponses: string[] };

function collectDiagnostics(page: Page): BrowserDiagnostics {
  const result: BrowserDiagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], badApiResponses: [] };
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  page.on('pageerror', error => result.pageErrors.push(error.message));
  page.on('requestfailed', request => {
    const failure = request.failure()?.errorText ?? 'request failed';
    if (failure !== 'net::ERR_ABORTED') {
      result.failedRequests.push(`${request.method()} ${request.url()}: ${failure}`);
    }
  });
  page.on('response', response => {
    if (response.status() >= 400) result.badApiResponses.push(`${response.status()} ${response.url()}`);
  });
  return result;
}

async function register(page: Page, name: string, email: string, password: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Họ và tên').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: `Chào ${name.split(' ')[0]}` })).toBeVisible();
  const sessionCookie = (await page.context().cookies()).find(cookie => cookie.name === 'vocabup_session');
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe('Strict');
  expect(sessionCookie?.secure).toBe(false);
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    scrollX: window.scrollX,
    mainLeft: document.querySelector('.main-area')?.getBoundingClientRect().left ?? 0,
    mainRight: document.querySelector('.main-area')?.getBoundingClientRect().right ?? 0,
  }));
  expect(dimensions.documentWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.innerWidth);
  expect(dimensions.bodyWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.innerWidth);
  expect(dimensions.scrollX, JSON.stringify(dimensions)).toBe(0);
  expect(dimensions.mainLeft, JSON.stringify(dimensions)).toBeGreaterThanOrEqual(0);
  expect(dimensions.mainRight, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.innerWidth + 1);
}

async function assertButtonCanBeClicked(page: Page, button: Locator): Promise<void> {
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.scrollIntoViewIfNeeded();
  await button.click({ trial: true });
}

async function waitForClosedMobileSidebar(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const sidebar = document.querySelector('.sidebar');
    return Boolean(sidebar && !sidebar.classList.contains('mobile-open') && sidebar.getBoundingClientRect().right <= 0);
  });
}

test('register, login, dashboard, deck/card CRUD, study, SRS, statistics and logout', async ({ page }) => {
  const diagnostics = collectDiagnostics(page);
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const email = `pw-${suffix}@example.test`;
  const password = `E2E!${randomBytes(24).toString('base64url')}9z`;
  const deckName = `E2E Deck ${suffix}`;
  const editedDeckName = `E2E Deck Updated ${suffix}`;
  const deletedWord = `e2e-delete-${suffix}`;
  const editedWord = `e2e-edited-${suffix}`;
  const studyWord = `e2e-study-${suffix}`;

  await register(page, 'E2E Learner', email, password);
  await expect(page.getByText('Bộ từ của bạn')).toBeVisible();

  await page.locator('.welcome-row').getByRole('button', { name: 'Tạo bộ từ', exact: true }).click();
  let modal = page.locator('.modal');
  await expect(modal.getByRole('heading', { name: 'Tạo bộ từ mới' })).toBeVisible();
  await modal.getByLabel('Tên bộ từ').fill(deckName);
  await modal.getByLabel(/Mô tả/).fill('Playwright isolated browser test');
  await modal.getByRole('button', { name: 'Tạo bộ từ' }).click();
  await expect(page.getByRole('heading', { name: deckName })).toBeVisible();

  await page.getByRole('button', { name: 'Sửa bộ từ', exact: true }).click();
  modal = page.locator('.modal');
  await modal.getByLabel('Tên bộ từ').fill(editedDeckName);
  await modal.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByRole('heading', { name: editedDeckName })).toBeVisible();

  await page.getByRole('button', { name: 'Thêm từ', exact: true }).click();
  modal = page.locator('.modal');
  await modal.getByLabel('Từ / cụm từ').fill(deletedWord);
  await modal.getByLabel('Nghĩa tiếng Anh / giải thích').fill('Word created to test delete');
  await modal.getByRole('button', { name: 'Thêm từ' }).click();
  let wordRow = page.locator('.vocab-row').filter({ hasText: deletedWord });
  await expect(wordRow).toBeVisible();

  await wordRow.locator('button[title="Sửa"]').click();
  modal = page.locator('.modal');
  await modal.getByLabel('Từ / cụm từ').fill(editedWord);
  await modal.getByLabel('Nghĩa tiếng Anh / giải thích').fill('Edited meaning');
  await modal.getByRole('button', { name: 'Lưu thay đổi' }).click();
  wordRow = page.locator('.vocab-row').filter({ hasText: editedWord });
  await expect(wordRow).toBeVisible();

  await wordRow.getByRole('button', { name: `Xóa thẻ ${editedWord}` }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Xóa' }).click();
  await expect(page.getByText(editedWord, { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Thêm từ', exact: true }).click();
  modal = page.locator('.modal');
  await modal.getByLabel('Từ / cụm từ').fill(studyWord);
  await modal.getByLabel('Nghĩa tiếng Anh / giải thích').fill('Word used for the SRS flow');
  await modal.getByRole('button', { name: 'Thêm từ' }).click();
  await expect(page.locator('.vocab-row').filter({ hasText: studyWord })).toBeVisible();

  await page.getByRole('button', { name: /Ôn tập/ }).click();
  const flashcard = page.locator('.flashcard');
  await expect(flashcard).toBeVisible();
  await expect(flashcard).toContainText(studyWord);
  await flashcard.click();
  await expect(page.locator('.rating-row')).toBeVisible();
  await page.locator('.rating-buttons button').last().click();
  await expect(page.locator('.complete-card')).toBeVisible();

  await page.getByRole('button', { name: 'Thống kê' }).click();
  await expect(page.getByRole('heading', { name: 'Thống kê học tập' })).toBeVisible();
  await expect(page.getByText('Hoạt động 7 ngày qua')).toBeVisible();

  await page.locator('.profile').click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.locator('.profile').click();
  await expect(page).toHaveURL(/\/login$/);

  expect(diagnostics).toMatchObject({ consoleErrors: [], pageErrors: [], failedRequests: [], badApiResponses: [] });
});

test('responsive dashboard, sidebar, modal bounds and actionable controls at requested viewports', async ({ page }) => {
  const diagnostics = collectDiagnostics(page);
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const email = `pw-responsive-${suffix}@example.test`;
  const password = `Responsive!${randomBytes(24).toString('base64url')}9z`;
  await register(page, 'Viewport Learner', email, password);

  await mkdir('artifacts/playwright/screenshots', { recursive: true });
  for (const width of [375, 390, 768, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.evaluate(() => window.scrollTo(0, 0));
    if (width <= 768) await waitForClosedMobileSidebar(page);
    await expect(page.getByRole('heading', { name: 'Chào Viewport' })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: `artifacts/playwright/screenshots/dashboard-${width}.png`, fullPage: true });

    if (width <= 768) {
      const menuButton = page.getByRole('button', { name: 'Mở menu' });
      await assertButtonCanBeClicked(page, menuButton);
      await menuButton.click();
      await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
      await page.getByRole('button', { name: 'Đóng menu' }).click();
      await waitForClosedMobileSidebar(page);
    } else {
      await expect(page.locator('.sidebar')).toBeVisible();
    }

    const createButton = page.locator('.welcome-row').getByRole('button', { name: 'Tạo bộ từ', exact: true });
    await assertButtonCanBeClicked(page, createButton);
    await createButton.click();
    const modal = page.locator('.modal');
    await expect(modal.getByRole('heading', { name: 'Tạo bộ từ mới' })).toBeVisible();
    const bounds = await modal.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
    });
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.right, JSON.stringify(bounds)).toBeLessThanOrEqual(bounds.viewportWidth + 1);
    expect(bounds.bottom, JSON.stringify(bounds)).toBeLessThanOrEqual(bounds.viewportHeight + 1);
    await assertNoHorizontalOverflow(page);
    const cancel = modal.getByRole('button', { name: 'Hủy' });
    await assertButtonCanBeClicked(page, cancel);
    await page.screenshot({ path: `artifacts/playwright/screenshots/modal-${width}.png`, fullPage: true });
    await cancel.click();

    if (width <= 768) await page.getByRole('button', { name: 'Mở menu' }).click();
    await page.getByRole('button', { name: 'Thống kê', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Thống kê học tập' })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    if (width <= 768) {
      await page.getByRole('button', { name: 'Mở menu' }).click();
      await page.getByRole('button', { name: 'Tổng quan', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Tổng quan', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Chào Viewport' })).toBeVisible();
  }

  expect(diagnostics).toMatchObject({ consoleErrors: [], pageErrors: [], failedRequests: [], badApiResponses: [] });
});
