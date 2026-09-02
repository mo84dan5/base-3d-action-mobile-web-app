// DOM 生成の小さな補助。ui 層専用。
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** pointerdown で反応するボタン(click を待たない)。マウスの右ボタンは処理せず伝播させる(カメラ回転用)。 */
export function onPress(target: HTMLElement, handler: (e: PointerEvent) => void): void {
  target.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    handler(e);
  });
}

/** CSS アニメーション・トランジションを再スタートさせるための強制リフロー。 */
export function forceReflow(target: HTMLElement): void {
  target.getBoundingClientRect();
}
