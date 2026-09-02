import { test, type Page } from '@playwright/test';

// 確認用スクリーンショット(横 / 縦 / ポーズ)。test-results/ に出力する。
async function waitLoaded(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector<HTMLButtonElement>('[data-testid="start"]')?.disabled === false,
  );
}

test('screenshots', async ({ page }) => {
  await page.goto('./');
  await waitLoaded(page);
  await page.screenshot({ path: 'test-results/shot-title-landscape.png' });
  await page
    .getByTestId('start')
    .dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
  await page.waitForTimeout(4500);
  await page.screenshot({ path: 'test-results/shot-play-landscape.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/shot-play-portrait.png' });
  await page
    .getByTestId('pause')
    .dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/shot-pause-portrait.png' });
});
