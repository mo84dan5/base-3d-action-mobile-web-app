import './ui/styles.css';
import { GameApp } from './app/gameApp';

// 配線(依存の注入)は GameApp が担う。ここでは起動のみ。
const root = document.getElementById('app');
if (!root) throw new Error('#app が見つかりません');
new GameApp(root).start();
