// dist/ の JS を gzip 圧縮した合計が上限(500 KB)を超えたら失敗させる(F07 バンドルサイズ)。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT_BYTES = 500 * 1024;
const distDir = new URL('../dist/', import.meta.url).pathname;

function collectJs(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return collectJs(full);
    return name.endsWith('.js') ? [full] : [];
  });
}

const files = collectJs(distDir);
let total = 0;
for (const file of files) {
  const gz = gzipSync(readFileSync(file)).length;
  total += gz;
  console.log(`${file.replace(distDir, '')}\t${(gz / 1024).toFixed(1)} KB gzip`);
}
console.log(
  `JS gzip 合計: ${(total / 1024).toFixed(1)} KB / 上限 ${(LIMIT_BYTES / 1024).toFixed(0)} KB`,
);
const maps = readdirSync(join(distDir, 'assets')).filter((f) => f.endsWith('.map'));
if (maps.length > 0) {
  console.error(`sourcemap が含まれています: ${maps.join(', ')}`);
  process.exit(1);
}
if (total > LIMIT_BYTES) {
  console.error('バンドルサイズが上限を超えています');
  process.exit(1);
}
