# base-3d-action-mobile-web-app

スマートフォン版・原神の操作を参考にした 3D アクション操作を持つ Web アプリの土台(ベース)。
特定ゲームの再現ではなく、再利用可能な操作基盤・戦闘基盤・地形移動基盤を提供する。

- 配信先: https://mo84dan5.github.io/base-3d-action-mobile-web-app/
- 技術スタック: Three.js + TypeScript + Vite(静的ファイルのみ。サーバサイド・DB なし)

## セットアップ

```bash
npm ci
npm run dev        # 開発サーバ(LAN 公開。スマートフォンから http://<PC の IP>:5173/base-3d-action-mobile-web-app/ で確認)
npm run lint       # ESLint + Prettier + 型チェック(DOM なし tsconfig を含む)
npm test           # Vitest(domain / application 層の単体テスト)
npm run e2e        # Playwright(ビルド → preview に対して実行)
npm run build      # dist/ を生成(sourcemap なし)
npm run check:bundle-size  # dist/ の JS gzip 合計が 500 KB 以下か検査
```

## レイヤ構成

依存の向きは外側から内側(domain)への一方向。ESLint と DOM なし `tsconfig.pure.json` で強制する。

| 層                   | 内容                                                                             | 依存できるもの                              |
| -------------------- | -------------------------------------------------------------------------------- | ------------------------------------------- |
| `src/domain`         | 状態機械、スタミナ、戦闘計算、物理判定、設定の検証、向きの判定(純粋 TS)          | なし                                        |
| `src/application`    | ゲームループ、入力コマンドの解釈、画面状態、ポート定義(純粋 TS)                  | domain                                      |
| `src/infrastructure` | Three.js レンダラ、地形コリジョン、Pointer Events / キーボード入力、localStorage | domain, application, Three.js, ブラウザ API |
| `src/ui`             | HUD・メニューの DOM 実装                                                         | application                                 |
| `src/main.ts`        | 配線(依存の注入)                                                                 | すべて                                      |

## 操作(PC 補助入力)

W/A/S/D 移動(Ctrl で歩き)、Shift ダッシュ/スプリント、Space ジャンプ、左クリック 攻撃、E スキル、Q バースト、F インタラクト、右ドラッグ カメラ、ホイール ズーム、Esc ポーズ。
