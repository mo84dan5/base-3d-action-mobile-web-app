import { expect, test, type Page } from '@playwright/test';
import type { ViewState } from '../src/application/viewState';

declare global {
  interface Window {
    __b3dDebug?: {
      view: () => ViewState | null;
      screen: () => string;
      grantEnergy?: (amount: number) => void;
      vfxAll?: () => string[];
      playerParts?: () => {
        angles: Record<'head' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg', number>;
        attachments: Record<'head' | 'rightArm' | 'leftArm', number>;
      } | null;
      preview?: () => {
        running: boolean;
        attachments: Record<'head' | 'rightArm' | 'leftArm', number>;
        locomotion: string;
        demo: string | null;
      } | null;
    };
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

test.describe('F07 入力遅延', () => {
  test('pointerdown から押下表示までが 2 フレーム以内', async ({ page }) => {
    await startGame(page);
    const frames = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const button = document.querySelector<HTMLButtonElement>('[data-testid="btn-jump"]');
          if (!button) {
            resolve(99);
            return;
          }
          button.dispatchEvent(
            new PointerEvent('pointerdown', {
              pointerType: 'touch',
              isPrimary: true,
              button: 0,
              pointerId: 31,
              bubbles: true,
            }),
          );
          let count = 0;
          const check = () => {
            if (button.classList.contains('pressed')) {
              resolve(count);
              return;
            }
            count++;
            if (count > 10) resolve(count);
            else requestAnimationFrame(check);
          };
          check();
        }),
    );
    expect(frames).toBeLessThanOrEqual(2);
  });
});

test.describe('S04 リザルトと遷移', () => {
  test('徘徊型に倒されると敗北のリザルトが出て、再挑戦で S02 に戻り、タイトルへ戻れる', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto('./?debug=1');
    const start = page.getByTestId('start');
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
    // 動かずに待つと徘徊型(id 2)が接近して攻撃し、HP 100 を 15 ずつ削る
    await page.waitForFunction(() => window.__b3dDebug?.screen() === 'result', null, {
      timeout: 150_000,
    });
    await expect(page.getByTestId('result-heading')).toHaveText('敗北');
    await expect(page.locator('.stats')).toContainText('経過時間');
    await expect(page.getByTestId('result-defeated')).toHaveText('0 / 2');
    const damage = Number(await page.getByTestId('result-damage').textContent());
    expect(damage).toBeGreaterThanOrEqual(100);
    await tap(page, 'retry');
    await expect(page.locator('[data-screen="result"]')).toBeHidden();
    await expect(page.getByTestId('countdown')).toContainText(/3|2|1|START/);
    await page.waitForFunction(() => (window.__b3dDebug?.view()?.player.hp ?? 0) === 100);
    await tap(page, 'pause');
    await tap(page, 'pause-title');
    await expect(page.locator('[data-screen="title"]')).toBeVisible();
    await expect(page.getByTestId('start')).toBeEnabled();
    await expect(page.locator('.progress')).toBeHidden();
  });
});

test.describe('S02 の設定反映とバックグラウンド化', () => {
  test('固定スティックと FPS 表示は S02 の初回表示から反映される', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'b3d.settings.v1',
        JSON.stringify({ version: 1, stickMode: 'fixed', showFps: true, quality: 'low' }),
      );
    });
    await startGame(page);
    const stick = page.getByTestId('stick');
    await expect(stick).toHaveClass(/visible/);
    const box = await stick.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x + box.width / 2).toBeCloseTo(844 * 0.25, -1);
      expect(box.y + box.height / 2).toBeCloseTo(390 * 0.7, -1);
    }
    await expect(page.locator('.fps')).toBeVisible();
    await expect(page.locator('.fps')).toContainText('fps');
  });

  test('バックグラウンド化(hidden)で S03 が開き、復帰しても自動再開しない', async ({ page }) => {
    await startGame(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('[data-screen="pause"]')).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('[data-screen="pause"]')).toBeVisible();
    await tap(page, 'resume');
    await expect(page.locator('[data-screen="pause"]')).toBeHidden();
  });

  test('表示品質を切り替えても描画が継続しエラーが出ない', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await startGame(page);
    await tap(page, 'pause');
    for (const q of ['low', 'high', 'medium']) {
      const b = page.getByTestId('setting-quality').locator(`button[data-value="${q}"]`);
      await b.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
      await expect(b).toHaveClass(/on/);
    }
    await tap(page, 'resume');
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
});

test.describe('残り項目の裏付け(S02 / F09 / F10)', () => {
  test('無効なボタン(バースト)上でドラッグしてもカメラは回らない', async ({ page }) => {
    await page.goto('./?debug=1');
    const start = page.getByTestId('start');
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
    await expect(page.getByTestId('btn-burst')).toHaveClass(/disabled/);
    const yawBefore = await page.evaluate(() => window.__b3dDebug?.view()?.camera.yaw ?? 0);
    const burst = page.getByTestId('btn-burst');
    const box = await burst.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await burst.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      pointerId: 41,
      clientX: cx,
      clientY: cy,
    });
    for (let i = 1; i <= 10; i++) {
      await page.locator('#app').dispatchEvent('pointermove', {
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 41,
        clientX: cx + i * 10,
        clientY: cy,
      });
    }
    await burst.dispatchEvent('pointerup', {
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      pointerId: 41,
      clientX: cx + 100,
      clientY: cy,
    });
    await page.waitForTimeout(300);
    const yawAfter = await page.evaluate(() => window.__b3dDebug?.view()?.camera.yaw ?? 0);
    expect(yawAfter).toBeCloseTo(yawBefore, 5);
  });

  test('一時停止中はワールド時間が進まず、再開後に進む', async ({ page }) => {
    await page.goto('./?debug=1');
    const start = page.getByTestId('start');
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
    await page.waitForFunction(() => (window.__b3dDebug?.view()?.worldTime ?? 0) > 0.5);
    await tap(page, 'pause');
    await expect(page.locator('[data-screen="pause"]')).toBeVisible();
    const t0 = await page.evaluate(() => window.__b3dDebug?.view()?.worldTime ?? 0);
    await page.waitForTimeout(600);
    const t1 = await page.evaluate(() => window.__b3dDebug?.view()?.worldTime ?? 0);
    expect(t1).toBe(t0);
    await tap(page, 'resume');
    await page.waitForFunction((t) => (window.__b3dDebug?.view()?.worldTime ?? 0) > t + 0.2, t0);
  });

  test('バックグラウンド中に回転して復帰すると新しい向きに再配置される', async ({ page }) => {
    await startGame(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('[data-screen="pause"]')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('html')).toHaveAttribute('data-orientation', 'portrait');
    await expect(page.locator('[data-screen="pause"]')).toBeVisible();
    const box = await page.getByTestId('action-buttons').boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.y).toBeGreaterThan(844 / 2);
  });
});

test.describe('攻撃スタイルと長押し攻撃(F03 / F04 / F06)', () => {
  async function startWithStyle(page: Page, style: string): Promise<void> {
    await page.addInitScript((s) => {
      localStorage.setItem('b3d.settings.v1', JSON.stringify({ version: 1, attackStyle: s }));
    }, style);
    await page.goto('./?debug=1');
    const start = page.getByTestId('start');
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
    await page.waitForFunction(() => window.__b3dDebug?.view()?.hud.phase === 'playing', null, {
      timeout: 20_000,
    });
  }
  const enemyHp = (page: Page, id: number) =>
    page.evaluate((i) => window.__b3dDebug?.view()?.enemies.find((x) => x.id === i)?.hp ?? -1, id);
  const approach = async (page: Page, id: number, within: number) => {
    await page.keyboard.down('KeyW');
    await page.waitForFunction(
      ([i, d]) => {
        const v = window.__b3dDebug?.view();
        const e = v?.enemies.find((x) => x.id === i);
        if (!v || !e) return false;
        return (
          Math.hypot(e.position.x - v.player.position.x, e.position.z - v.player.position.z) < d
        );
      },
      [id, within] as const,
      { timeout: 30_000 },
    );
    await page.keyboard.up('KeyW');
  };
  const waitWorld = (page: Page, seconds: number) =>
    page
      .evaluate(() => window.__b3dDebug?.view()?.worldTime ?? 0)
      .then((t0) =>
        page.waitForFunction((t) => (window.__b3dDebug?.view()?.worldTime ?? 0) > t, t0 + seconds, {
          timeout: 20_000,
        }),
      );

  test('銃撃: 攻撃ボタンで正面の徘徊型に 8 ダメージ、長押しで離すとタメ打ちで倒す', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await startWithStyle(page, 'gun');
    await approach(page, 3, 9);
    await page.waitForFunction(
      () => window.__b3dDebug?.view()?.hud.buttons.attack.enabled === true,
    );
    await tap(page, 'btn-attack');
    await waitWorld(page, 0.4);
    expect(await enemyHp(page, 3)).toBe(52);
    // 長押し: pointerdown → タメ(リング表示)→ 1.1 秒後に pointerup
    const attack = page.getByTestId('btn-attack');
    await attack.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      pointerId: 51,
    });
    await page.waitForFunction(() => (window.__b3dDebug?.view()?.hud.chargeRatio ?? 0) >= 1, null, {
      timeout: 20_000,
    });
    await expect(attack).toHaveClass(/charging/);
    await attack.dispatchEvent('pointerup', {
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      pointerId: 51,
    });
    await waitWorld(page, 0.6);
    expect(await enemyHp(page, 3)).toBeLessThanOrEqual(0);
  });

  test('格闘: 攻撃ボタン長押しで接近強攻撃が出て 35 ダメージ、スタミナが 25 減る', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await startWithStyle(page, 'melee');
    await approach(page, 3, 5);
    await page.waitForFunction(
      () => window.__b3dDebug?.view()?.hud.buttons.attack.enabled === true,
    );
    const staminaBefore = await page.evaluate(() => window.__b3dDebug?.view()?.player.stamina ?? 0);
    const attack = page.getByTestId('btn-attack');
    await attack.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      pointerId: 52,
    });
    await page.waitForFunction(
      () => window.__b3dDebug?.view()?.player.state === 'strongAttack',
      null,
      {
        timeout: 20_000,
      },
    );
    const staminaAfter = await page.evaluate(() => window.__b3dDebug?.view()?.player.stamina ?? 0);
    expect(staminaBefore - staminaAfter).toBeGreaterThanOrEqual(24);
    await attack.dispatchEvent('pointerup', {
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      pointerId: 52,
    });
    await waitWorld(page, 1.5);
    expect(await enemyHp(page, 3)).toBeLessThanOrEqual(25);
  });

  test('S03 の「装備を組み替える」で S05 が右腕タブで開き、選択が保存されてスロットタブの装備名が変わる', async ({
    page,
  }) => {
    await startGame(page);
    await tap(page, 'pause');
    await tap(page, 'setting-equipment');
    await expect(page.locator('[data-screen="equipment"]')).toBeVisible();
    await expect(page.getByTestId('slot-tab-rightArm')).toHaveClass(/on/);
    await expect(page.getByTestId('slot-tab-rightArm')).toContainText('格闘');
    await expect(page.getByTestId('style-category-sword')).toHaveClass(/on/);
    await tap(page, 'style-category-firearm');
    await tap(page, 'style-item-shotgun');
    await expect(page.getByTestId('style-item-shotgun')).toHaveClass(/on/);
    await expect(page.getByTestId('style-detail-name')).toHaveText('ショットガン');
    await expect(page.getByTestId('style-unimplemented')).toHaveCount(0);
    const stored = await page.evaluate(() => localStorage.getItem('b3d.settings.v1'));
    expect(stored).toContain('"rightArm":"shotgun"');
    await expect(page.getByTestId('slot-tab-rightArm')).toContainText('ショットガン');
    await tap(page, 'style-done');
    await expect(page.locator('[data-screen="equipment"]')).toBeHidden();
    await expect(page.locator('[data-screen="pause"]')).toBeVisible();
    await tap(page, 'resume');
    await expect(page.getByTestId('style-name')).toContainText('右: ショットガン');
  });

  test('S05 の左腕タブ・頭タブを切り替えて選んだ装備がそれぞれのスロットに保存される(F12 / S05)', async ({
    page,
  }) => {
    await startGame(page);
    await tap(page, 'pause');
    await tap(page, 'setting-equipment');
    await expect(page.locator('[data-screen="equipment"]')).toBeVisible();
    await expect(page.getByTestId('slot-tab-head')).toContainText('レーザー');
    await expect(page.getByTestId('slot-tab-leftArm')).toContainText('衝撃波');
    await tap(page, 'slot-tab-leftArm');
    await expect(page.getByTestId('slot-tab-leftArm')).toHaveClass(/on/);
    await expect(page.getByTestId('style-category-magic')).toHaveClass(/on/);
    await expect(page.getByTestId('style-item-shockwave')).toHaveClass(/on/);
    await tap(page, 'slot-tab-head');
    await expect(page.getByTestId('slot-tab-head')).toHaveClass(/on/);
    await expect(page.getByTestId('style-category-firearm')).toHaveClass(/on/);
    await expect(page.getByTestId('style-item-laser')).toHaveClass(/on/);
    await tap(page, 'style-category-ranged');
    await tap(page, 'style-item-bow');
    const stored = await page.evaluate(() => localStorage.getItem('b3d.settings.v1'));
    expect(stored).toContain('"head":"bow"');
    expect(stored).toContain('"leftArm":"shockwave"');
    await expect(page.getByTestId('slot-tab-head')).toContainText('弓');
    await expect(page.getByTestId('slot-tab-leftArm')).toContainText('衝撃波');
    await tap(page, 'style-done');
    await tap(page, 'resume');
    await expect(page.getByTestId('btn-head')).toContainText('弓');
    await expect(page.getByTestId('btn-leftArm')).toContainText('衝撃波');
    await expect(page.getByTestId('btn-attack')).toContainText('格闘');
  });

  test('HUD の技ボタンは 攻撃(右腕)・左腕・頭 の 3 つで、縦画面では左列に 頭 → 左腕 → バースト の順に並ぶ(S02)', async ({
    page,
  }) => {
    await startGame(page);
    const boxOf = async (id: string) => {
      const b = await page.getByTestId(id).boundingBox();
      if (!b) throw new Error(`${id} not visible`);
      return b;
    };
    const attack = await boxOf('btn-attack');
    const leftArm = await boxOf('btn-leftArm');
    const head = await boxOf('btn-head');
    expect(attack.width).toBeGreaterThan(leftArm.width);
    expect(leftArm.x).toBeLessThan(attack.x);
    expect(head.x).toBeLessThan(leftArm.x);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(':root')).toHaveAttribute('data-orientation', 'portrait');
    const pHead = await boxOf('btn-head');
    const pLeft = await boxOf('btn-leftArm');
    const pBurst = await boxOf('btn-burst');
    const pAttack = await boxOf('btn-attack');
    expect(pHead.y).toBeLessThan(pLeft.y);
    expect(pLeft.y).toBeLessThan(pBurst.y);
    expect(Math.abs(pHead.x - pLeft.x)).toBeLessThan(2);
    expect(pAttack.x).toBeGreaterThan(pLeft.x + pLeft.width);
  });

  test('S05 は 10 系統 × 10 スタイルを一覧に出し、未実装のスタイルは無い', async ({ page }) => {
    await startGame(page);
    await tap(page, 'pause');
    await tap(page, 'setting-equipment');
    const categories = [
      'sword',
      'strike',
      'polearm',
      'firearm',
      'ranged',
      'magic',
      'placement',
      'defense',
      'movement',
      'special',
    ];
    for (const c of categories) {
      await tap(page, `style-category-${c}`);
      await expect(page.getByTestId('style-list').locator('button')).toHaveCount(10);
      await expect(page.getByTestId('style-list').getByText('未実装')).toHaveCount(0);
    }
    await tap(page, 'style-close');
    await expect(page.locator('[data-screen="equipment"]')).toBeHidden();
  });

  test('ショットガン: 攻撃ボタンで 5 本の散弾が出て正面の徘徊型にダメージが入る', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await startWithStyle(page, 'shotgun');
    await expect(page.getByTestId('style-name')).toContainText('右: ショットガン');
    await approach(page, 3, 5.5);
    const before = await enemyHp(page, 3);
    // 徘徊型は接近して攻撃してくるため、押下が被弾で無効になることがある。ダメージが入るまで押し直す
    for (let i = 0; i < 6; i++) {
      await page.waitForFunction(
        () => window.__b3dDebug?.view()?.hud.buttons.attack.enabled === true,
      );
      await tap(page, 'btn-attack');
      await waitWorld(page, 0.4);
      if ((await enemyHp(page, 3)) < before) break;
    }
    expect(await enemyHp(page, 3)).toBeLessThan(before);
    const tracers = await page.evaluate(
      () =>
        window.__b3dDebug?.vfxAll?.().filter((n) => n.startsWith('vfx_shoot_tracer')).length ?? 0,
    );
    expect(tracers).toBeGreaterThanOrEqual(5);
  });

  test('魔力弾: 追尾する発射体が敵に当たり、エネルギーを消費する', async ({ page }) => {
    test.setTimeout(120_000);
    await startWithStyle(page, 'magic_bolt');
    await approach(page, 3, 8);
    // エネルギーは初期 0 なので、デバッグ用フックでセッションへ直接与える
    await page.evaluate(() => window.__b3dDebug?.grantEnergy?.(50));
    await page.waitForFunction(
      () => window.__b3dDebug?.view()?.hud.buttons.attack.enabled === true,
    );
    const before = await enemyHp(page, 3);
    await tap(page, 'btn-attack');
    await page.waitForFunction(
      () => (window.__b3dDebug?.view()?.projectiles.length ?? 0) > 0,
      null,
      {
        timeout: 10_000,
      },
    );
    await page.waitForFunction(
      ([i, hp]) => (window.__b3dDebug?.view()?.enemies.find((x) => x.id === i)?.hp ?? hp) < hp,
      [3, before] as const,
      { timeout: 20_000 },
    );
    expect(await enemyHp(page, 3)).toBeLessThan(before);
    const energy = await page.evaluate(() => window.__b3dDebug?.view()?.hud.energyRatio ?? 1);
    // 消費 3 とヒットの獲得 3 で相殺されるため、上限は 0.5(獲得だけなら 0.53 になる)
    expect(energy).toBeLessThanOrEqual(0.5);
  });
});

test.describe('パーツ分けキャラクター(F12 / デザインディレクション キャラクター)', () => {
  test('頭・右腕・左腕に装備の付属物が付き、攻撃ボタンで右腕が前へ振れる', async ({ page }) => {
    await page.goto('./?debug=1');
    const start = page.getByTestId('start');
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
    await page.waitForFunction(() => window.__b3dDebug?.view()?.hud.phase === 'playing', null, {
      timeout: 20_000,
    });
    const parts = await page.evaluate(() => window.__b3dDebug?.playerParts?.());
    expect(parts?.attachments).toEqual({ head: 1, rightArm: 1, leftArm: 1 });
    expect(parts?.angles.rightArm).toBe(0);
    await tap(page, 'btn-attack');
    await page.waitForFunction(
      () => (window.__b3dDebug?.playerParts?.()?.angles.rightArm ?? 0) < -0.5,
      null,
      { timeout: 2_000 },
    );
    await page.waitForFunction(
      () => Math.abs(window.__b3dDebug?.playerParts?.()?.angles.rightArm ?? 1) < 1e-6,
      null,
      { timeout: 3_000 },
    );
  });
});

test.describe('HUD のバー表示(S02 要素 2・3)', () => {
  test('縦画面でも HP バー本体が 120 px 以上あり、スタミナ行は満タン時も表示されている', async ({
    page,
  }) => {
    await startGame(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('html')).toHaveAttribute('data-orientation', 'portrait');
    const box = await page.getByTestId('hp-bar').boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.width).toBeGreaterThanOrEqual(120);
    await page.waitForTimeout(1200);
    await expect(page.getByTestId('stamina-row')).toBeVisible();
    await expect(page.getByTestId('stamina-bar')).toBeVisible();
    const st = await page.getByTestId('stamina-bar').boundingBox();
    expect(st).not.toBeNull();
    if (st) expect(st.width).toBeGreaterThanOrEqual(120);
  });

  test('エネルギーバー(要素 18)が常時表示され、現在値/最大値を併記する', async ({ page }) => {
    await startGame(page);
    await expect(page.getByTestId('energy-row')).toBeVisible();
    await expect(page.getByTestId('energy-bar')).toBeVisible();
    await expect(page.getByTestId('energy-label')).toHaveText(/^\d+\/100$/);
    const en = await page.getByTestId('energy-bar').boundingBox();
    expect(en).not.toBeNull();
    if (en) expect(en.width).toBeGreaterThanOrEqual(120);
  });
});

test.describe('S05 装備組み替え: 脚スロット・プレビュー・縦画面(F12 / S05 / #99963)', () => {
  async function startDebug(page: Page): Promise<void> {
    await page.goto('./?debug=1');
    const start = page.getByTestId('start');
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
    await expect(page.getByTestId('action-buttons')).toBeVisible();
  }

  test('脚タブに移動タイプ 6 件が出て、二足以外は未実装。選ぶと locomotion に保存され再読み込み後も保持される', async ({
    page,
  }) => {
    await startGame(page);
    await tap(page, 'pause');
    await tap(page, 'setting-equipment');
    await expect(page.getByTestId('slot-tab-legs')).toContainText('二足');
    await tap(page, 'slot-tab-legs');
    await expect(page.getByTestId('slot-tab-legs')).toHaveClass(/on/);
    await expect(page.getByTestId('style-tabs')).toBeHidden();
    await expect(page.getByTestId('style-list').locator('button')).toHaveCount(6);
    await expect(page.getByTestId('style-list').getByText('未実装')).toHaveCount(5);
    await expect(page.getByTestId('locomotion-item-biped')).toHaveClass(/on/);
    await expect(page.getByTestId('locomotion-unimplemented')).toHaveCount(0);
    await tap(page, 'locomotion-item-hover');
    await expect(page.getByTestId('locomotion-item-hover')).toHaveClass(/on/);
    await expect(page.getByTestId('style-detail-name')).toHaveText('浮遊');
    await expect(page.getByTestId('locomotion-unimplemented')).toBeVisible();
    await expect(page.getByTestId('slot-tab-legs')).toContainText('浮遊');
    const stored = await page.evaluate(() => localStorage.getItem('b3d.settings.v1'));
    expect(stored).toContain('"locomotion":"hover"');
    // 頭 / 腕の装備は変わらない
    expect(stored).toContain('"rightArm":"melee"');
    await page.reload();
    await expect(page.getByTestId('start')).toBeEnabled({ timeout: 30_000 });
    const after = await page.evaluate(() => localStorage.getItem('b3d.settings.v1'));
    expect(after).toContain('"locomotion":"hover"');
  });

  test('プレビュー(小窓)は S05 表示中だけ描画し、選んだ装備の付属物とデモモーションを反映する', async ({
    page,
  }) => {
    await startDebug(page);
    await tap(page, 'pause');
    expect(await page.evaluate(() => window.__b3dDebug?.preview?.() ?? null)).toBeNull();
    await tap(page, 'setting-equipment');
    await expect(page.getByTestId('equipment-preview')).toBeVisible();
    await page.waitForFunction(() => window.__b3dDebug?.preview?.()?.running === true);
    const box = await page.getByTestId('equipment-preview').boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThan(100);
      expect(box.height).toBeGreaterThan(100);
    }
    const info = await page.evaluate(() => window.__b3dDebug?.preview?.() ?? null);
    expect(info?.attachments.head).toBeGreaterThan(0);
    expect(info?.attachments.rightArm).toBeGreaterThan(0);
    expect(info?.attachments.leftArm).toBeGreaterThan(0);
    expect(info?.locomotion).toBe('biped');
    await tap(page, 'slot-tab-head');
    await tap(page, 'style-category-ranged');
    await tap(page, 'style-item-bow');
    // 選んだ瞬間にそのスロットのデモ(押下モーション)が始まる
    expect((await page.evaluate(() => window.__b3dDebug?.preview?.()?.demo)) ?? null).toBe('head');
    // 本編のキャラクターの付属物も差し替わる(S03 の背景)
    await page.waitForFunction(
      () => (window.__b3dDebug?.view()?.player.equipment.head.category ?? '') === 'ranged',
    );
    await tap(page, 'style-close');
    await expect(page.locator('[data-screen="equipment"]')).toBeHidden();
    expect(await page.evaluate(() => window.__b3dDebug?.preview?.()?.running)).toBe(false);
  });

  test('縦画面(390×844)で S03 の設定行が重ならず、S05 が表示領域内に収まる(F09 / S03 / S05)', async ({
    page,
  }) => {
    await startGame(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(':root')).toHaveAttribute('data-orientation', 'portrait');
    await tap(page, 'pause');
    const rows = page.locator('[data-screen="pause"] .setting-row');
    const count = await rows.count();
    expect(count).toBe(7);
    let bottom = -Infinity;
    for (let i = 0; i < count; i++) {
      const b = await rows.nth(i).boundingBox();
      expect(b).not.toBeNull();
      if (!b) continue;
      expect(b.y).toBeGreaterThanOrEqual(bottom - 1);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
      bottom = b.y + b.height;
    }
    const equipmentButton = await page.getByTestId('setting-equipment').boundingBox();
    expect(equipmentButton).not.toBeNull();
    if (equipmentButton) expect(equipmentButton.x + equipmentButton.width).toBeLessThanOrEqual(390);
    await tap(page, 'setting-equipment');
    const screen = await page.locator('[data-screen="equipment"]').boundingBox();
    expect(screen).not.toBeNull();
    if (screen) {
      expect(screen.width).toBeLessThanOrEqual(390);
      expect(screen.height).toBeLessThanOrEqual(844);
    }
    const preview = await page.getByTestId('equipment-preview').boundingBox();
    const list = await page.getByTestId('style-list').boundingBox();
    const done = await page.getByTestId('style-done').boundingBox();
    expect(preview && list && done).toBeTruthy();
    if (preview && list && done) {
      expect(preview.height).toBeCloseTo(180, -1);
      expect(list.y).toBeGreaterThanOrEqual(preview.y + preview.height - 1);
      expect(done.y + done.height).toBeLessThanOrEqual(844);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // 横画面に戻しても閉じない
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator(':root')).toHaveAttribute('data-orientation', 'landscape');
    await expect(page.locator('[data-screen="equipment"]')).toBeVisible();
    await expect(page.getByTestId('equipment-preview')).toBeVisible();
  });
});
