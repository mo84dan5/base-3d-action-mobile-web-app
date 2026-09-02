import { expect, test, type Page } from '@playwright/test';
import type { ViewState } from '../src/application/viewState';

declare global {
  interface Window {
    __b3dDebug?: { view: () => ViewState | null; screen: () => string };
  }
}

// F07 テスト方針: タップ・単一ポインタのドラッグ・ビューポート変更(844×390 ↔ 390×844)の範囲に限定する。

async function startGame(page: Page): Promise<void> {
  await page.goto('./');
  const start = page.getByTestId('start');
  await expect(start).toBeEnabled({ timeout: 30_000 });
  await start.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
  await expect(page.getByTestId('action-buttons')).toBeVisible();
}

async function tap(page: Page, testId: string): Promise<void> {
  const el = page.getByTestId(testId);
  await el.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    pointerId: 9,
  });
  await el.dispatchEvent('pointerup', {
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    pointerId: 9,
  });
}

test.describe('S01 タイトル画面', () => {
  test('読み込み完了で「はじめる」が有効になり、バージョンが表示される', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('.version')).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(page.getByTestId('start')).toBeEnabled({ timeout: 30_000 });
    await expect(page.locator('.progress')).toBeHidden();
  });
});

test.describe('S02 プレイ画面', () => {
  test('「はじめる」で S02 へ遷移し、横画面レイアウトで開始カウントダウンが表示される', async ({
    page,
  }) => {
    await startGame(page);
    await expect(page.locator('html')).toHaveAttribute('data-orientation', 'landscape');
    await expect(page.getByTestId('countdown')).toContainText(/3|2|1|START/);
    await expect(page.getByTestId('hp-bar')).toBeVisible();
  });

  test('ボタンは pointerdown で即時に反応する(押下表示が同期的に付く)', async ({ page }) => {
    await startGame(page);
    const jump = page.getByTestId('btn-jump');
    await jump.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      pointerId: 5,
    });
    await expect(jump).toHaveClass(/pressed/);
    await jump.dispatchEvent('pointerup', {
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      pointerId: 5,
    });
    await expect(jump).not.toHaveClass(/pressed/);
  });

  test('スティック領域(左半分)のタッチでスティックが出現し、離すと消える', async ({ page }) => {
    await startGame(page);
    const app = page.locator('#app');
    await app.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      isPrimary: true,
      clientX: 150,
      clientY: 250,
      pointerId: 11,
      button: 0,
    });
    await expect(page.getByTestId('stick')).toHaveClass(/visible/);
    await app.dispatchEvent('pointerup', {
      pointerType: 'touch',
      isPrimary: true,
      clientX: 150,
      clientY: 250,
      pointerId: 11,
      button: 0,
    });
    await expect(page.getByTestId('stick')).not.toHaveClass(/visible/);
  });

  test('カメラ領域(右半分)の単一ポインタのドラッグでエラーなく操作できる', async ({ page }) => {
    await startGame(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const app = page.locator('#app');
    await app.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      isPrimary: true,
      clientX: 600,
      clientY: 150,
      pointerId: 12,
      button: 0,
    });
    for (let i = 1; i <= 10; i++) {
      await app.dispatchEvent('pointermove', {
        pointerType: 'touch',
        isPrimary: true,
        clientX: 600 + i * 8,
        clientY: 150,
        pointerId: 12,
      });
    }
    await app.dispatchEvent('pointerup', {
      pointerType: 'touch',
      isPrimary: true,
      clientX: 680,
      clientY: 150,
      pointerId: 12,
      button: 0,
    });
    await expect(page.getByTestId('stick')).not.toHaveClass(/visible/);
    expect(errors).toEqual([]);
  });

  test('ポーズボタンで S03 が開き、再開で S02 に戻る', async ({ page }) => {
    await startGame(page);
    await tap(page, 'pause');
    await expect(page.locator('[data-screen="pause"]')).toBeVisible();
    await tap(page, 'resume');
    await expect(page.locator('[data-screen="pause"]')).toBeHidden();
    await expect(page.getByTestId('action-buttons')).toBeVisible();
  });
});

test.describe('F09 画面の向き', () => {
  test('ビューポートを 844×390 → 390×844 に変えると data-orientation と HUD 配置が縦画面になる', async ({
    page,
  }) => {
    await startGame(page);
    await expect(page.locator('html')).toHaveAttribute('data-orientation', 'landscape');
    const landscapeButtons = await page.getByTestId('action-buttons').boundingBox();
    expect(landscapeButtons).not.toBeNull();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('html')).toHaveAttribute('data-orientation', 'portrait');
    const box = await page.getByTestId('action-buttons').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    // 下半分の右に収まる
    expect(box.x).toBeGreaterThan(390 / 2);
    expect(box.y).toBeGreaterThan(844 / 2);
    expect(box.x + box.width).toBeLessThanOrEqual(390 + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(844 + 1);
    // 縦画面では下半分の左でスティックが出現する
    const app = page.locator('#app');
    await app.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      isPrimary: true,
      clientX: 80,
      clientY: 700,
      pointerId: 21,
      button: 0,
    });
    await expect(page.getByTestId('stick')).toHaveClass(/visible/);
    await app.dispatchEvent('pointerup', {
      pointerType: 'touch',
      isPrimary: true,
      clientX: 80,
      clientY: 700,
      pointerId: 21,
      button: 0,
    });
    // 上半分のタッチではスティックが出ない
    await app.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      isPrimary: true,
      clientX: 80,
      clientY: 200,
      pointerId: 22,
      button: 0,
    });
    await expect(page.getByTestId('stick')).not.toHaveClass(/visible/);
    await app.dispatchEvent('pointerup', {
      pointerType: 'touch',
      isPrimary: true,
      clientX: 80,
      clientY: 200,
      pointerId: 22,
      button: 0,
    });
  });

  test('回転してもポーズせず、S03 を開いたまま回転しても閉じない', async ({ page }) => {
    await startGame(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[data-screen="pause"]')).toBeHidden();
    await tap(page, 'pause');
    await expect(page.locator('[data-screen="pause"]')).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('html')).toHaveAttribute('data-orientation', 'landscape');
    await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  });
});

test.describe('F06 設定と永続化', () => {
  test('設定変更後に再読み込みしても保持される', async ({ page }) => {
    await startGame(page);
    await tap(page, 'pause');
    const fixed = page.getByTestId('setting-stickMode').locator('button[data-value="fixed"]');
    await fixed.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
    await expect(fixed).toHaveClass(/on/);
    const stored = await page.evaluate(() => localStorage.getItem('b3d.settings.v1'));
    expect(stored).toContain('"stickMode":"fixed"');
    await page.reload();
    await expect(page.getByTestId('start')).toBeEnabled({ timeout: 30_000 });
    const again = await page.evaluate(() => localStorage.getItem('b3d.settings.v1'));
    expect(again).toContain('"stickMode":"fixed"');
  });
});

test.describe('F04 戦闘(補助入力)', () => {
  test('キーボードで正面の徘徊型へ近づいて攻撃すると HP が減り、敵 HP バーが出る', async ({
    page,
  }) => {
    await page.goto('./?debug=1');
    const start = page.getByTestId('start');
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
    await page.waitForFunction(() => window.__b3dDebug?.view()?.hud.phase === 'playing', null, {
      timeout: 20_000,
    });
    // 徘徊型(id 3)は開始地点の正面 +z 方向 20 m にいる。W だけで近づき、正面のまま攻撃する
    const TARGET = 3;
    const distance = () =>
      page.evaluate((id) => {
        const v = window.__b3dDebug?.view();
        const e = v?.enemies.find((x) => x.id === id);
        if (!v || !e) return Infinity;
        return Math.hypot(e.position.x - v.player.position.x, e.position.z - v.player.position.z);
      }, TARGET);
    await page.keyboard.down('KeyW');
    await page.waitForFunction(
      (id) => {
        const v = window.__b3dDebug?.view();
        const e = v?.enemies.find((x) => x.id === id);
        if (!v || !e) return false;
        return (
          Math.hypot(e.position.x - v.player.position.x, e.position.z - v.player.position.z) < 2.4
        );
      },
      TARGET,
      { timeout: 30_000 },
    );
    await page.keyboard.up('KeyW');
    const enemyHp = () =>
      page.evaluate(
        (id) => window.__b3dDebug?.view()?.enemies.find((x) => x.id === id)?.hp ?? 60,
        TARGET,
      );
    // 実行環境の描画速度に依存しないよう、ワールド時間(物理ステップの累積)で待つ
    for (let i = 0; i < 12; i++) {
      await page.waitForFunction(
        () => window.__b3dDebug?.view()?.hud.buttons.attack.enabled === true,
        null,
        { timeout: 20_000 },
      );
      const t0 = await page.evaluate(() => window.__b3dDebug?.view()?.worldTime ?? 0);
      await tap(page, 'btn-attack');
      await page.waitForFunction((t) => (window.__b3dDebug?.view()?.worldTime ?? 0) > t + 0.5, t0, {
        timeout: 20_000,
      });
      if ((await enemyHp()) < 60) break;
    }
    const debug = await page.evaluate(() =>
      JSON.stringify({
        player: window.__b3dDebug?.view()?.player,
        enemies: window.__b3dDebug?.view()?.enemies,
      }),
    );
    expect(await enemyHp(), `${debug} distance=${await distance()}`).toBeLessThan(60);
    await expect(page.getByTestId(`enemy-hp-${TARGET}`)).toBeVisible();
  });
});
